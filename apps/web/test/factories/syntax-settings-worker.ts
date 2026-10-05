import { onTestFinished } from 'vitest'
import { createClientInvariantError } from '@/lib/structured-errors'

type SyntaxWorkerFamily = 'shiki' | 'tree-sitter'
type NativeRequest = {
  readonly id: number
  readonly family: SyntaxWorkerFamily
  readonly type: string
  readonly runtimeSessionId: string | null
}
type NativeReply = {
  readonly worker: Worker
  readonly event: MessageEvent<unknown>
  readonly request: NativeRequest
}

export function holdSyntaxWorkerReply(family: SyntaxWorkerFamily) {
  const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')
  if (!descriptor) throw createClientInvariantError('Native Worker postMessage is unavailable')
  const post = Worker.prototype.postMessage
  const pending = new Map<Worker, Map<number, NativeRequest>>()
  const listeners = new Map<Worker, (event: MessageEvent<unknown>) => void>()
  let armed = false
  let held: NativeReply | null = null
  let restored = false

  const listen = (worker: Worker) => {
    if (listeners.has(worker)) return
    const listener = (event: MessageEvent<unknown>) => {
      const id = messageId(event.data)
      const request = id === null ? undefined : pending.get(worker)?.get(id)
      if (!armed || request?.type !== 'edit' || request.family !== family) return
      armed = false
      event.stopImmediatePropagation()
      held = { worker, event, request }
    }
    const onmessage = worker.onmessage
    // Worker target listeners run in registration order; hold before onmessage receives the reply.
    worker.onmessage = null
    worker.addEventListener('message', listener, true)
    worker.onmessage = onmessage
    listeners.set(worker, listener)
  }

  Object.defineProperty(Worker.prototype, 'postMessage', {
    ...descriptor,
    value: function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      listen(this)
      const request = nativeRequest(args[0])
      if (request) {
        const requests = pending.get(this) ?? new Map<number, NativeRequest>()
        requests.set(request.id, request)
        pending.set(this, requests)
      }
      Reflect.apply(post, this, args)
    },
  })

  const release = () => {
    armed = false
    const reply = held
    held = null
    if (reply) reply.worker.dispatchEvent(new MessageEvent('message', { data: reply.event.data }))
  }
  const restore = () => {
    if (restored) return
    restored = true
    release()
    Object.defineProperty(Worker.prototype, 'postMessage', descriptor)
    for (const [worker, listener] of listeners)
      worker.removeEventListener('message', listener, true)
    pending.clear()
    listeners.clear()
  }
  onTestFinished(restore)
  return {
    arm: () => {
      if (armed || held) throw createClientInvariantError('Native syntax gate already holds work')
      armed = true
    },
    held: () => (held ? { request: held.request, data: held.event.data } : null),
    release,
    restore,
  }
}

function messageId(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  return typeof value.id === 'number' ? value.id : null
}

function nativeRequest(value: unknown): NativeRequest | null {
  const id = messageId(value)
  if (!value || typeof value !== 'object' || !('payload' in value)) return null
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null
  if (typeof payload.type !== 'string') return null
  const runtimeSessionId =
    'runtimeSessionId' in payload && typeof payload.runtimeSessionId === 'string'
      ? payload.runtimeSessionId
      : null
  const mark = performance.getEntriesByName('editor.worker.request').at(-1)
  if (id === null || !(mark instanceof PerformanceMark)) return null
  const detail: unknown = mark.detail
  if (!detail || typeof detail !== 'object' || !('family' in detail) || !('type' in detail))
    return null
  if (
    (detail.family !== 'shiki' && detail.family !== 'tree-sitter') ||
    detail.type !== payload.type ||
    !('runtimeSessionId' in detail) ||
    detail.runtimeSessionId !== runtimeSessionId
  )
    return null
  return { id, family: detail.family, type: payload.type, runtimeSessionId }
}
