import { onTestFinished } from 'vitest'
import { createClientInvariantError } from '@/lib/structured-errors'
import { holdRetentionAcceptanceWorkerReply } from './retention-acceptance-worker-reply'

type Request = ReturnType<ReturnType<typeof holdRetentionAcceptanceWorkerReply>['requests']>[number]
type Receipt = {
  readonly id: number
  readonly payload: object
  readonly mark: {
    readonly name: string
    readonly startTime: number
    readonly duration: number
    readonly detail: unknown
  } | null
}

export function holdRetentionIdentityWorkerReply() {
  const original = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')
  if (!original) throw createClientInvariantError('Native Worker postMessage is unavailable')
  const gate = holdRetentionAcceptanceWorkerReply()
  const forward = Worker.prototype.postMessage
  const message = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')
  const setMessage = message?.set
  if (!message || !setMessage) {
    gate.restore()
    throw createClientInvariantError('Native Worker message handler is unavailable')
  }
  const hookedWorkers = new WeakSet<Worker>()
  const receipts: Receipt[] = []
  Object.defineProperty(Worker.prototype, 'onmessage', {
    ...message,
    set: function (this: Worker, listener: Worker['onmessage']) {
      hookedWorkers.add(this)
      setMessage.call(this, listener)
    },
  })
  Object.defineProperty(Worker.prototype, 'postMessage', {
    ...original,
    value: function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      if (!hookedWorkers.has(this) && this.onmessage) {
        setMessage.call(this, this.onmessage)
        hookedWorkers.add(this)
      }
      const receipt = packetReceipt(args[0])
      if (receipt) receipts.push(receipt)
      Reflect.apply(forward, this, args)
    },
  })
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    gate.restore()
    Object.defineProperty(Worker.prototype, 'postMessage', original)
    receipts.length = 0
  }
  onTestFinished(restore)
  const enriched = (request: Request) => {
    const receipt = receipts.find((candidate) => matchesRequest(candidate, request))
    return {
      ...request,
      payload: request.runtimeSessionId === null ? null : (receipt?.payload ?? null),
      mark: receipt?.mark ?? null,
    }
  }
  return {
    arm: gate.arm,
    requests: () => gate.requests().map(enriched),
    held: () => gate.held().map((reply) => ({ ...reply, request: enriched(reply.request) })),
    release: gate.release,
    restore,
  }
}

function packetReceipt(value: unknown): Receipt | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'number')
    return null
  if (!('payload' in value) || !value.payload || typeof value.payload !== 'object') return null
  const entry = performance.getEntriesByName('editor.worker.request').at(-1)
  return {
    id: value.id,
    payload: value.payload,
    mark:
      entry instanceof PerformanceMark
        ? {
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            detail: entry.detail,
          }
        : null,
  }
}

function matchesRequest(receipt: Receipt, request: Request) {
  if (receipt.id !== request.id) return false
  const detail = receipt.mark?.detail
  if (!detail || typeof detail !== 'object') return false
  return (
    'family' in detail &&
    detail.family === request.family &&
    'type' in detail &&
    detail.type === request.type &&
    'runtimeSessionId' in detail &&
    detail.runtimeSessionId === request.runtimeSessionId
  )
}
