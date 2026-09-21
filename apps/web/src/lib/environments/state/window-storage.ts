import type { EnvironmentId } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'

export function environmentWindowStorage(environmentId: EnvironmentId): ScopedStorage {
  const prefix = `env:${environmentId}|`
  return {
    environmentId,
    getItem(key) {
      try {
        return sessionStorage.getItem(prefix + key)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        sessionStorage.setItem(prefix + key, value)
        return 'written'
      } catch {
        return 'storage-failed'
      }
    },
    removeItem(key) {
      try {
        sessionStorage.removeItem(prefix + key)
      } catch {
        return
      }
    },
    keys(keyPrefix) {
      try {
        return Object.keys(sessionStorage)
          .filter((key) => key.startsWith(prefix + keyPrefix))
          .map((key) => key.slice(prefix.length))
      } catch {
        return []
      }
    },
  }
}
