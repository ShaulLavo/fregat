import { beforeEach } from 'vitest'
import { WORKSPACE_CACHE_STORAGE_NAMESPACE } from '@/lib/workspace-cache-storage'

// Every application runtime persists its workspace, so a test starts from the cache it seeds.
beforeEach(() => {
  for (const key of Object.keys(localStorage))
    if (key.includes(WORKSPACE_CACHE_STORAGE_NAMESPACE)) localStorage.removeItem(key)
})
