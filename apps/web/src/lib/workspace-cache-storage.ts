import {
  globalChromeStorage,
  type StorageAccess,
  type StorageWriteStatus,
} from '@/lib/environments/state/scoped-storage'
import { reportClientError } from '@/lib/client-error-reporting'
import * as v from 'valibot'

// Local-only UI cache versions are dropped on mismatch, never migrated.
export const WORKSPACE_CACHE_VERSION = 21
export const WORKSPACE_CACHE_STORAGE_PREFIX = `platform.workspace-state.v${WORKSPACE_CACHE_VERSION}`
export const WORKSPACE_CACHE_STORAGE_NAMESPACE = 'platform.workspace-state.v'

export type WorkspaceCacheWriteResult = {
  readonly serializedBytes: number | null
  readonly status: StorageWriteStatus | 'serialization-failed' | 'oversized'
}

type WorkspaceCacheEntryOptions = {
  readonly storage?: StorageAccess
  readonly maxSerializedBytes?: number
}

type CacheReadFailure = 'invalid-json' | 'schema' | 'oversized' | 'read-failed'

export function workspaceCacheStorageKey(suffix: string) {
  return `${WORKSPACE_CACHE_STORAGE_PREFIX}.${suffix}`
}

export function workspaceCacheSerializedBytes(serialized: string) {
  return serialized.length * 2
}

export function readWorkspaceCacheEntry<T>(
  key: string,
  schema: v.GenericSchema,
  fallback: T,
  options: WorkspaceCacheEntryOptions = {},
): T {
  const storage = options.storage ?? globalChromeStorage
  let serialized: string | null
  try {
    serialized = storage.getItem(key)
  } catch {
    return recoverCacheEntry({ key, reason: 'read-failed', storage, fallback })
  }
  if (serialized === null) return fallback
  if (serializedEntryIsOversized(serialized, options.maxSerializedBytes)) {
    return recoverCacheEntry({ key, reason: 'oversized', storage, fallback })
  }

  let input: unknown
  try {
    input = JSON.parse(serialized)
  } catch {
    return recoverCacheEntry({ key, reason: 'invalid-json', storage, fallback })
  }

  try {
    const result = v.safeParse(schema, input)
    if (result.success) return result.output as T
  } catch {
    return recoverCacheEntry({ key, reason: 'schema', storage, fallback })
  }
  return recoverCacheEntry({ key, reason: 'schema', storage, fallback })
}

export function writeWorkspaceCacheEntry(
  key: string,
  value: unknown,
  options: WorkspaceCacheEntryOptions = {},
): WorkspaceCacheWriteResult {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { serializedBytes: null, status: 'serialization-failed' }
  }

  if (serialized === undefined) {
    return { serializedBytes: null, status: 'serialization-failed' }
  }

  const serializedBytes = workspaceCacheSerializedBytes(serialized)
  if (serializedBytes > (options.maxSerializedBytes ?? Number.POSITIVE_INFINITY)) {
    return { serializedBytes, status: 'oversized' }
  }

  try {
    const status = (options.storage ?? globalChromeStorage).setItem(key, serialized)
    return { serializedBytes, status }
  } catch {
    return { serializedBytes, status: 'storage-failed' }
  }
}

export function removeWorkspaceCacheEntry(
  key: string,
  storage: StorageAccess = globalChromeStorage,
) {
  try {
    storage.removeItem(key)
  } catch {
    // A blocked store must not prevent the app from opening.
  }
}

function serializedEntryIsOversized(serialized: string, maxSerializedBytes?: number) {
  if (maxSerializedBytes === undefined) return false

  return workspaceCacheSerializedBytes(serialized) > maxSerializedBytes
}

function recoverCacheEntry<T>({
  key,
  reason,
  storage,
  fallback,
}: {
  readonly key: string
  readonly reason: CacheReadFailure
  readonly storage: StorageAccess
  readonly fallback: T
}): T {
  if (reason !== 'read-failed') removeWorkspaceCacheEntry(key, storage)
  reportClientError({
    area: 'workspace-cache',
    operation: 'cache.read',
    message:
      reason === 'read-failed'
        ? 'Local cache could not be read.'
        : 'Invalid local cache entry was discarded.',
    context: { cacheKey: key, reason },
  })
  return fallback
}
