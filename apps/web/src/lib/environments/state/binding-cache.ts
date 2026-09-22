import {
  storedEnvironmentScopes,
  type ScopedStorage,
} from '@/lib/environments/state/scoped-storage'
import {
  healthDescriptorSchema,
  machineNameSchema,
  originMachineSchema,
  type EnvironmentId,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  writeWorkspaceCacheEntry,
} from '@/lib/workspace-cache-storage'

export const ENVIRONMENT_BINDING_STORAGE_KEY = 'platform.environments.binding.v1'
const MAX_CACHE_BYTES = 16_384

const environmentBindingSchema = v.object({
  names: v.array(v.union([v.literal('local'), machineNameSchema])),
  origin: originMachineSchema.entries.url,
  descriptor: healthDescriptorSchema,
})
const recordSchema = v.object({ binding: environmentBindingSchema })

export type EnvironmentCacheBinding = Omit<
  v.InferOutput<typeof environmentBindingSchema>,
  'names'
> & {
  readonly names: readonly string[]
}

const cacheBindings = new Map<EnvironmentId, EnvironmentCacheBinding>()

function readEnvironmentBinding(storage: ScopedStorage): EnvironmentCacheBinding | null {
  const cached = readWorkspaceCacheEntry<v.InferOutput<typeof recordSchema> | null>(
    ENVIRONMENT_BINDING_STORAGE_KEY,
    recordSchema,
    null,
    { storage, maxSerializedBytes: MAX_CACHE_BYTES },
  )
  if (!cached) return null
  // A binding that names another environment is a scope mix-up, not stale data.
  if (cached.binding.descriptor.environmentId !== storage.environmentId) {
    removeWorkspaceCacheEntry(ENVIRONMENT_BINDING_STORAGE_KEY, storage)
    return null
  }
  cacheBindings.set(storage.environmentId, cached.binding)
  return cached.binding
}

export function recordEnvironmentCacheBinding(
  storage: ScopedStorage,
  binding: EnvironmentCacheBinding,
) {
  if (binding.descriptor.environmentId !== storage.environmentId) return false
  const previous = readEnvironmentBinding(storage) ?? cacheBindings.get(storage.environmentId)
  const names = [...new Set([...(previous?.names ?? []), ...binding.names])]
  const origin = previous?.names.includes('local') ? previous.origin : binding.origin
  const next = { ...binding, names, origin }
  cacheBindings.set(storage.environmentId, next)
  const result = writeWorkspaceCacheEntry(
    ENVIRONMENT_BINDING_STORAGE_KEY,
    { binding: next },
    { storage, maxSerializedBytes: MAX_CACHE_BYTES },
  )
  return result.status === 'written'
}

export function readCachedEnvironmentBindings(
  names: readonly string[],
): readonly EnvironmentCacheBinding[] {
  const wanted = new Set(names)
  return storedEnvironmentScopes(ENVIRONMENT_BINDING_STORAGE_KEY).flatMap((storage) => {
    const binding = readEnvironmentBinding(storage)
    if (!binding || !binding.names.some((name) => wanted.has(name))) return []
    return [binding]
  })
}
