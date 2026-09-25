import { createClientInvariantError } from '@/lib/structured-errors'
import { createDatabaseResource } from '@/lib/resources/state/database'

const DATABASE = 'platform-chat-attachment-blobs'
const STORE = 'blobs'
const MAX_STAGED_BYTES = 400 * 1024 * 1024
const database = createDatabaseResource({
  name: DATABASE,
  version: 1,
  initialize: (db) => {
    db.createObjectStore(STORE)
  },
  errorMessage: 'Attachment recovery storage is unavailable.',
})
if (import.meta.hot) import.meta.hot.dispose(database.close)
export async function storeAttachmentBlob(key: string, blob: Blob) {
  const db = await database.open()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const existing = store.getAll()
    existing.onsuccess = () => {
      const bytes = (existing.result as Blob[]).reduce((sum, entry) => sum + entry.size, 0)
      if (bytes + blob.size > MAX_STAGED_BYTES) {
        transaction.abort()
        return
      }
      store.put(blob, key)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () =>
      reject(
        createClientInvariantError(
          'Attachment recovery storage is full. Remove staged files and retry.',
        ),
      )
  })
}
export async function readAttachmentBlob(key: string): Promise<Blob | null> {
  const db = await database.open()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
    request.onerror = () =>
      reject(createClientInvariantError('The staged attachment could not be restored.'))
  })
}
export async function deleteAttachmentBlob(key: string) {
  const db = await database.open()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () =>
      reject(createClientInvariantError('The staged attachment could not be removed.'))
  })
}
