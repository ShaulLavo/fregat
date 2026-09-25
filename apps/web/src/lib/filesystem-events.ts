import type { QueryClient } from '@tanstack/react-query'
import type { WatchServerMessage } from '@workspace/contracts'

type FilesystemEvent =
  | Extract<WatchServerMessage, { type: 'created' | 'changed' | 'deleted' | 'renamed' }>
  | { readonly type: 'rescan'; readonly path: string }
type Listener = (events: readonly FilesystemEvent[]) => void
const listeners = new WeakMap<QueryClient, Set<Listener>>()

export function publishFilesystemEvents(client: QueryClient, events: readonly FilesystemEvent[]) {
  for (const listener of listeners.get(client) ?? []) listener(events)
}

export function subscribeFilesystemEvents(client: QueryClient, listener: Listener) {
  const group = listeners.get(client) ?? new Set<Listener>()
  listeners.set(client, group)
  group.add(listener)
  return () => {
    group.delete(listener)
    if (group.size === 0) listeners.delete(client)
  }
}
