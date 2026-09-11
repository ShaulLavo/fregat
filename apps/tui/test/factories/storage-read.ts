import type { FileStorage } from '@/storage/files'

export function interleaveStorageRead(storage: FileStorage, key: string, interleave: () => void) {
  let pending = true
  return {
    ...storage,
    getItem(requestedKey: string) {
      const raw = storage.getItem(requestedKey)
      if (!pending || requestedKey !== key) return raw
      pending = false
      interleave()
      return raw
    },
  }
}
