import {
  providerModelSchema,
  providerSnapshotSchema,
  type ProviderModel,
  type ProviderSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'

const PROVIDER_DISPLAY_CACHE_KEY = 'platform.provider-display.v1'
const providerDisplaySchema = v.object({
  ...v.pick(providerSnapshotSchema, ['providerInstanceId', 'driverKind', 'displayLabel']).entries,
  models: v.array(v.pick(providerModelSchema, ['slug', 'name', 'shortName', 'capabilities'])),
})
const providerDisplayCacheSchema = v.array(providerDisplaySchema)

export type ProviderDisplay = Pick<
  ProviderSnapshot,
  'providerInstanceId' | 'driverKind' | 'displayLabel'
> & {
  readonly models: readonly Pick<ProviderModel, 'slug' | 'name' | 'shortName' | 'capabilities'>[]
}

export function readProviderDisplayCache(storage: ScopedStorage): readonly ProviderDisplay[] {
  return readWorkspaceCacheEntry(PROVIDER_DISPLAY_CACHE_KEY, providerDisplayCacheSchema, [], {
    storage,
  })
}

export function writeProviderDisplayCache(
  storage: ScopedStorage,
  providers: readonly ProviderDisplay[],
) {
  // The schema projects display fields, excluding live auth and readiness at every level.
  const display = v.parse(providerDisplayCacheSchema, providers)
  return writeWorkspaceCacheEntry(PROVIDER_DISPLAY_CACHE_KEY, display, { storage })
}
