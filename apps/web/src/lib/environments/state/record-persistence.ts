import type { EnvironmentId } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type { WorkspaceCacheWriteResult } from '@/lib/workspace-cache-storage'

export function createEnvironmentRecordPersistence<T>({
  read,
  write,
}: {
  readonly read: (storage: ScopedStorage) => Readonly<Record<string, T>>
  readonly write: (
    storage: ScopedStorage,
    entries: Readonly<Record<string, T>>,
  ) => WorkspaceCacheWriteResult
}) {
  const adapters = new Map<EnvironmentId, ScopedStorage>()
  return {
    hydrate(storage: ScopedStorage, current: Readonly<Record<string, T>> = {}) {
      adapters.set(storage.environmentId, storage)
      return {
        ...Object.fromEntries(
          Object.entries(current).filter(([key]) => !key.startsWith(`${storage.environmentId}:`)),
        ),
        ...ownedEntries(storage, read(storage)),
      }
    },
    persist(entries: Readonly<Record<string, T>>) {
      let written = true
      for (const storage of adapters.values()) {
        const result = write(storage, ownedEntries(storage, entries))
        if (result.status !== 'written') written = false
      }
      return written
    },
  }
}

function ownedEntries<T>(storage: ScopedStorage, entries: Readonly<Record<string, T>>) {
  const prefix = `${storage.environmentId}:`
  return Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith(prefix)))
}
