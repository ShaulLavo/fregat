import { environmentIdSchema, type EnvironmentId } from '@workspace/contracts'
import * as v from 'valibot'

export type StorageWriteStatus = 'written' | 'unavailable' | 'storage-failed'

export type StorageAccess = Pick<Storage, 'getItem' | 'removeItem'> & {
  readonly setItem: (key: string, value: string) => StorageWriteStatus
  readonly keys: (prefix: string) => readonly string[]
}

export type ScopedStorage = StorageAccess & {
  readonly environmentId: EnvironmentId
}

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export const globalChromeStorage: StorageAccess = {
  getItem(key) {
    try {
      return browserStorage()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      const storage = browserStorage()
      if (!storage) return 'unavailable'
      storage.setItem(key, value)
      return 'written'
    } catch {
      return 'storage-failed'
    }
  },
  removeItem(key) {
    try {
      browserStorage()?.removeItem(key)
    } catch {
      return
    }
  },
  keys(prefix) {
    try {
      const storage = browserStorage()
      if (!storage) return []
      return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
        (key): key is string => key !== null && key.startsWith(prefix),
      )
    } catch {
      return []
    }
  },
}

export function environmentScopedStorage(environmentId: EnvironmentId): ScopedStorage {
  const namespace = `env:${environmentId}|`
  return {
    environmentId,
    getItem: (key) => globalChromeStorage.getItem(`${namespace}${key}`),
    setItem: (key, value) => globalChromeStorage.setItem(`${namespace}${key}`, value),
    removeItem: (key) => globalChromeStorage.removeItem(`${namespace}${key}`),
    keys: (prefix) =>
      globalChromeStorage.keys(`${namespace}${prefix}`).map((key) => key.slice(namespace.length)),
  }
}

export function storedEnvironmentScopes(key: string): readonly ScopedStorage[] {
  try {
    const suffix = `|${key}`
    return globalChromeStorage.keys('env:').flatMap((storedKey) => {
      if (!storedKey.endsWith(suffix)) return []
      const parsed = v.safeParse(environmentIdSchema, storedKey.slice(4, -suffix.length))
      return parsed.success ? [environmentScopedStorage(parsed.output)] : []
    })
  } catch {
    return []
  }
}

export function forgetEnvironmentStorage(environmentId: string): boolean {
  const namespace = `env:${environmentId}|`
  for (const key of globalChromeStorage.keys(namespace)) globalChromeStorage.removeItem(key)
  forgetWindowEntries(namespace)
  return globalChromeStorage.keys(namespace).length === 0
}

function forgetWindowEntries(namespace: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(namespace)) sessionStorage.removeItem(key)
    }
  } catch {
    return
  }
}
