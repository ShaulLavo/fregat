// Runs Bun's native `fs.watch` off the server's main thread: attaching a recursive watch walks
// every directory synchronously, which froze the whole server for 10.8 s on a 485k-directory root.
// Built next to the server bundle (`apps/server/package.json` build), so it imports nothing local.
import { watch, type FSWatcher } from 'node:fs'
import type {
  NativeWatchError,
  NativeWatchRequest,
  NativeWatchResponse,
} from './native-watch-protocol'

declare const self: Worker

const watchers = new Map<number, FSWatcher>()
let batch: Array<[number, string, string]> = []
let flushScheduled = false

self.onmessage = (message: MessageEvent<NativeWatchRequest>) => {
  const request = message.data
  if (request.type === 'close') {
    watchers.get(request.id)?.close()
    watchers.delete(request.id)
    return
  }
  attach(request.id, request.path, request.recursive)
}

function attach(id: number, target: string, recursive: boolean) {
  const startedAt = performance.now()
  const attachErrors: NativeWatchError[] = []
  let attached = false
  try {
    const watcher = watch(target, { recursive }, (event, filename) => {
      queueEvent(id, event, filename?.toString() ?? '')
    })
    watcher.on('error', (error) => {
      if (attached) post({ type: 'error', id, error: nativeWatchError(error) })
      else attachErrors.push(nativeWatchError(error))
    })
    watchers.set(id, watcher)
  } catch (error) {
    post({ type: 'failed', id, error: nativeWatchError(error) })
    return
  }
  const attachMs = performance.now() - startedAt
  // The walk's own errors (an unreadable subdirectory) arrive after `watch` returns.
  setTimeout(() => {
    attached = true
    post({ type: 'attached', id, attachMs, errors: attachErrors })
  }, 0)
}

function queueEvent(id: number, event: string, filename: string) {
  batch.push([id, event, filename])
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(flushEvents)
}

function flushEvents() {
  flushScheduled = false
  const events = batch
  batch = []
  post({ type: 'events', events })
}

function post(response: NativeWatchResponse) {
  postMessage(response)
}

function nativeWatchError(error: unknown): NativeWatchError {
  if (!(error instanceof Error)) return { message: String(error) }
  const details = error as Error & { code?: unknown; path?: unknown }
  return {
    code: typeof details.code === 'string' ? details.code : undefined,
    message: error.message,
    path: typeof details.path === 'string' ? details.path : undefined,
  }
}
