import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type * as v from 'valibot'

export function createScopedRecordStorage<T extends { readonly updatedAt: number }>({
  key,
  schema,
  recordKey,
  version,
  limit,
}: {
  readonly key: string
  readonly schema: v.GenericSchema<unknown, Record<string, T>>
  readonly recordKey: string
  readonly version: number
  readonly limit: number
}) {
  return {
    read(storage: ScopedStorage) {
      const entries = readWorkspaceCacheEntry<Record<string, T>>(key, schema, {}, { storage })
      return pruneEntries(entries, limit)
    },
    write(storage: ScopedStorage, entries: Readonly<Record<string, T>>) {
      return writeWorkspaceCacheEntry(key, { [recordKey]: entries, version }, { storage })
    },
    prune(entries: Readonly<Record<string, T>>, maximum = limit) {
      return pruneEntries(entries, maximum)
    },
    nextStamp: nextRecordStamp<T>,
  }
}

function pruneEntries<T extends { readonly updatedAt: number }>(
  entries: Readonly<Record<string, T>>,
  limit: number,
): Record<string, T> {
  const pairs = Object.entries(entries)
  if (pairs.length <= limit) return { ...entries }

  return Object.fromEntries(
    pairs.toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt).slice(0, limit),
  )
}

// Eviction order must advance even when the wall clock stands still or moves backwards.
function nextRecordStamp<T extends { readonly updatedAt: number }>(
  entries: Readonly<Record<string, T>>,
): number {
  let highest = 0
  for (const entry of Object.values(entries)) highest = Math.max(highest, entry.updatedAt)
  return Math.max(Date.now(), highest + 1)
}
