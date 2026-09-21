import type * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'

export function readReloadCache<T>(
  key: string,
  schema: v.GenericSchema,
  storage: ScopedStorage,
  maxBytes: number,
): T | null {
  const start = performance.now()
  let bytes = 0
  const observedStorage: ScopedStorage = {
    ...storage,
    getItem(name) {
      const value = storage.getItem(name)
      bytes = (value?.length ?? 0) * 2
      return value
    },
  }
  const record = readWorkspaceCacheEntry<T | null>(key, schema, null, {
    storage: observedStorage,
    maxSerializedBytes: maxBytes,
  })
  performance.clearMeasures(`workspace.reload.${key}`)
  performance.measure(`workspace.reload.${key}`, {
    start,
    detail: { bytes, maxBytes, restored: record !== null },
  })
  return record
}
