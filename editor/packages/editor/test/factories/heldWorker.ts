import { expect } from 'vitest'

type ReplyGate = {
  readonly requests: unknown[]
  readonly ids: Set<number>
  readonly held: MessageEvent<unknown>[]
  readonly produced: unknown[]
  armed: boolean
  deliver: ((event: MessageEvent<unknown>) => void) | null
}
export function heldNativeWorkerReplies(url: URL, kinds: readonly string[]) {
  const gate: ReplyGate = {
    requests: [],
    ids: new Set(),
    held: [],
    produced: [],
    armed: false,
    deliver: null,
  }
  return {
    requests: gate.requests,
    held: gate.held,
    produced: gate.produced,
    releaseFirst: () => releaseFirst(gate),
    arm: () => {
      gate.armed = true
    },
    releaseAll: () => {
      gate.armed = false
      while (gate.held.length) releaseFirst(gate)
    },
    createWorker: () => gatedWorker(url, kinds, gate),
  }
}
function releaseFirst(gate: ReplyGate): void {
  const event = gate.held.shift()
  if (event) gate.deliver?.(event)
}
function gatedWorker(url: URL, kinds: readonly string[], gate: ReplyGate): Worker {
  const worker = new Worker(url, { type: 'module' })
  trackRequests(worker, kinds, gate)
  const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')
  if (!descriptor?.set) expect.fail('Native worker message descriptor unavailable')
  Object.defineProperty(worker, 'onmessage', {
    configurable: true,
    set: (listener: Worker['onmessage']) => {
      gate.deliver = (event) => listener?.call(worker, event)
      descriptor.set?.call(worker, (event: MessageEvent<unknown>) => deliverOrHold(event, gate))
    },
  })
  return worker
}
function trackRequests(worker: Worker, kinds: readonly string[], gate: ReplyGate): void {
  const post = worker.postMessage
  worker.postMessage = (value: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
    gate.requests.push(value)
    const id = domainMessageId(value, kinds)
    if (id !== null) gate.ids.add(id)
    Reflect.apply(post, worker, [value, transfer])
  }
}
function deliverOrHold(event: MessageEvent<unknown>, gate: ReplyGate): void {
  if (gate.armed && gate.ids.has(messageId(event.data) ?? -1)) {
    gate.held.push(event)
    gate.produced.push(event.data)
    return
  }
  gate.deliver?.(event)
}
function messageId(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  return typeof value.id === 'number' ? value.id : null
}
function domainMessageId(value: unknown, kinds: readonly string[]): number | null {
  if (!value || typeof value !== 'object' || !('payload' in value)) return null
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null
  return typeof payload.type === 'string' && kinds.includes(payload.type) ? messageId(value) : null
}
