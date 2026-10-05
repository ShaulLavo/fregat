import { onTestFinished } from 'vitest'
import { createClientInvariantError } from '@/lib/structured-errors'

type RequestIdentity = {
  readonly id: number
  readonly type: string
  readonly family: 'shiki' | 'tree-sitter' | 'unknown'
  readonly runtimeSessionId: string | null
}

type HeldReply = {
  readonly worker: Worker
  readonly event: MessageEvent<unknown>
  readonly request: RequestIdentity
}

export function holdRetentionAcceptanceWorkerReply() {
  const post = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')
  const message = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')
  const nativePost = Worker.prototype.postMessage
  if (!post || !message?.set)
    throw createClientInvariantError(
      'Retention acceptance native Worker message descriptors are unavailable',
    )
  const requests = new Map<Worker, Map<number, RequestIdentity>>()
  const listeners = new Map<Worker, Worker['onmessage']>()
  const replies: HeldReply[] = []
  let requestedType: string | null = null
  let requestedFamily: RequestIdentity['family'] | null = null
  let restored = false
  Object.defineProperty(Worker.prototype, 'postMessage', {
    ...post,
    value: function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      const request = requestIdentity(args[0])
      if (request) {
        const pending = requests.get(this) ?? new Map<number, RequestIdentity>()
        pending.set(request.id, request)
        requests.set(this, pending)
      }
      Reflect.apply(nativePost, this, args)
    },
  })
  Object.defineProperty(Worker.prototype, 'onmessage', {
    ...message,
    set: function (this: Worker, listener: Worker['onmessage']) {
      listeners.set(this, listener)
      if (!listener) {
        message.set?.call(this, null)
        return
      }
      message.set?.call(this, (event: MessageEvent<unknown>) => {
        const id = replyId(event.data)
        const request = id === null ? null : requests.get(this)?.get(id)
        if (request && requestedType === request.type && requestedFamily === request.family) {
          requestedType = null
          replies.push({ worker: this, event, request })
          return
        }
        listener.call(this, event)
      })
    },
  })
  const release = () => {
    requestedType = null
    for (const reply of replies.splice(0)) {
      const listener = listeners.get(reply.worker)
      listener?.call(reply.worker, reply.event)
    }
  }
  const restore = () => {
    if (restored) return
    restored = true
    release()
    Object.defineProperty(Worker.prototype, 'postMessage', post)
    Object.defineProperty(Worker.prototype, 'onmessage', message)
    for (const [worker, listener] of listeners) message.set?.call(worker, listener)
    listeners.clear()
    requests.clear()
  }
  onTestFinished(restore)
  return {
    arm: (type: string, family: 'shiki' | 'tree-sitter') => {
      if (requestedType || replies.length)
        throw createClientInvariantError('Retention acceptance worker gate already owns a response')
      requestedType = type
      requestedFamily = family
    },
    requests: () => [...requests.values()].flatMap((pending) => [...pending.values()]),
    held: () => replies.map(({ event, request }) => ({ request, response: event.data })),
    release,
    restore,
  }
}

function requestIdentity(value: unknown): RequestIdentity | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'number')
    return null
  if (!('payload' in value) || !value.payload || typeof value.payload !== 'object') return null
  const payload = value.payload
  if (!('type' in payload) || typeof payload.type !== 'string') return null
  const runtimeSessionId =
    'runtimeSessionId' in payload && typeof payload.runtimeSessionId === 'string'
      ? payload.runtimeSessionId
      : null
  return {
    id: value.id,
    family: requestFamily(payload.type, runtimeSessionId),
    type: payload.type,
    runtimeSessionId,
  }
}

function replyId(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  return typeof value.id === 'number' ? value.id : null
}

function requestFamily(type: string, runtimeSessionId: string | null): RequestIdentity['family'] {
  const entry = performance.getEntriesByName('editor.worker.request').at(-1)
  if (!(entry instanceof PerformanceMark)) return 'unknown'
  const detail: unknown = entry.detail
  if (
    !detail ||
    typeof detail !== 'object' ||
    !('family' in detail) ||
    !('type' in detail) ||
    detail.type !== type ||
    !('runtimeSessionId' in detail) ||
    detail.runtimeSessionId !== runtimeSessionId
  )
    return 'unknown'
  return detail.family === 'shiki' || detail.family === 'tree-sitter' ? detail.family : 'unknown'
}
