import { errorSummary } from '../observability'
import type { WatchServerMessage } from './contracts'
import type { WorkspacePaths } from './path'
import type { FileChangeHub } from './watch'

export type TreeWatch = {
  /** Absolute directory. */
  readonly path: string
  readonly depth: 'recursive' | 'shallow'
}

export type TreeWatchChange = {
  /** Absolute path. */
  readonly path: string
  readonly type: 'created' | 'changed' | 'deleted'
}

export type TreeWatchCallbacks = {
  readonly change: (change: TreeWatchChange) => void
  readonly error: (message: string) => void
}

/** Resolves once the native watch is attached; the returned function detaches it. */
export type TreeWatchSource = (
  watch: TreeWatch,
  callbacks: TreeWatchCallbacks,
) => Promise<() => Promise<void>>

/**
 * Server-side consumers of the hub, such as language servers, watch through the same native
 * watchers as the browser's streams, including the paths the tree hides.
 */
export function treeWatchSource(changes: FileChangeHub, paths: WorkspacePaths): TreeWatchSource {
  return async (watch, callbacks) => {
    const relative = paths.toRelative(watch.path)
    const controller = new AbortController()
    const events = changes.stream([relative], controller.signal, {
      includeIgnored: true,
      shallow: watch.depth === 'shallow',
    })
    const ready = Promise.withResolvers<void>()
    const drained = (async () => {
      for await (const event of events) {
        if (event.type === 'ready') ready.resolve()
        deliver(event, paths, callbacks)
      }
      ready.resolve()
    })().catch((error: unknown) => {
      ready.reject(error)
      callbacks.error(errorSummary(error).message)
    })
    await ready.promise
    return async () => {
      controller.abort()
      await drained
    }
  }
}

function deliver(event: WatchServerMessage, paths: WorkspacePaths, callbacks: TreeWatchCallbacks) {
  if (event.type === 'error') {
    callbacks.error(event.message)
    return
  }
  if (event.type === 'renamed') {
    callbacks.change({ path: paths.resolve(event.oldPath).absolutePath, type: 'deleted' })
    callbacks.change({ path: paths.resolve(event.path).absolutePath, type: 'created' })
    return
  }
  if (event.type !== 'created' && event.type !== 'changed' && event.type !== 'deleted') return
  callbacks.change({ path: paths.resolve(event.path).absolutePath, type: event.type })
}
