import type { TreeEntry } from './tree-entry'

/** How a stream's roots are watched; `limited` roots watch their own entries only. */
export type WatchCoverage = {
  mode: 'recursive' | 'shallow' | 'limited'
  /** Directories counted under the root; for `limited`, the tally when counting stopped. */
  directoryCount?: number
  /** Directories the limit still had free when this root attached. */
  available?: number
  limit?: number
}

export type WatchServerMessage =
  | { type: 'ready'; root: string; sequence?: number; watch?: WatchCoverage }
  | { type: 'subscribed'; path: string; sequence?: number }
  | { type: 'unsubscribed'; path: string; sequence?: number }
  | { type: 'pong'; sequence?: number }
  | {
      type: 'created'
      path: string
      entry?: TreeEntry
      origin?: string
      sequence?: number
      version?: string
      writeId?: string
    }
  | {
      type: 'changed'
      path: string
      entry?: TreeEntry
      origin?: string
      sequence?: number
      version?: string
      writeId?: string
    }
  | {
      type: 'deleted'
      path: string
      origin?: string
      sequence?: number
      version?: string
      writeId?: string
    }
  | {
      type: 'renamed'
      path: string
      oldPath: string
      entry?: TreeEntry
      origin?: string
      sequence?: number
      version?: string
      writeId?: string
    }
  | {
      type: 'error'
      code: string
      message: string
      why?: string
      fix?: string
      /** The watcher root or open file that failed; streams that do not use it never see the error. */
      path?: string
      sequence?: number
    }

export type WatchClientMessage =
  | { type: 'subscribe'; path: string }
  | { type: 'unsubscribe'; path: string }
  | { type: 'ping' }
