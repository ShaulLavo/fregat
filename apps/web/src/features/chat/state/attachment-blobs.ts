import { createClientInvariantError } from '@/lib/structured-errors'
import { createDatabaseResource } from '@/lib/resources/state/database'
import * as v from 'valibot'

const storedBlobSchema = v.object({ bytes: v.instance(ArrayBuffer), mimeType: v.string() })
function restoreBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value
  const parsed = v.safeParse(storedBlobSchema, value)
  return parsed.success ? new Blob([parsed.output.bytes], { type: parsed.output.mimeType }) : null
}
function storedSize(value: unknown): number {
  if (value instanceof Blob) return value.size
  const parsed = v.safeParse(storedBlobSchema, value)
  return parsed.success ? parsed.output.bytes.byteLength : 0
}

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
  if (blob.size > MAX_STAGED_BYTES)
    throw createClientInvariantError(
      'Attachment recovery storage is full. Remove staged files and retry.',
    )
  const db = await database.open()
  // WebKit can abort IndexedDB transactions that serialize Blob or File objects.
  const stored = { bytes: await blob.arrayBuffer(), mimeType: blob.type }
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    let bytesExceedBudget = false
    const store = transaction.objectStore(STORE)
    const previous = store.get(key)
    const existing = store.getAll()
    existing.onsuccess = () => {
      const bytes = existing.result.reduce(
        (sum: number, entry: unknown) => sum + storedSize(entry),
        0,
      )
      if (bytes - storedSize(previous.result) + blob.size > MAX_STAGED_BYTES) {
        bytesExceedBudget = true
        transaction.abort()
        return
      }
      store.put(stored, key)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () =>
      reject(
        createClientInvariantError(
          transaction.error?.name === 'QuotaExceededError' || bytesExceedBudget
            ? 'Attachment recovery storage is full. Remove staged files and retry.'
            : 'The attachment could not be saved for recovery. Remove it and attach it again.',
          transaction.error,
        ),
      )
  })
}
export async function readAttachmentBlob(key: string): Promise<Blob | null> {
  const db = await database.open()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key)
    request.onsuccess = () => resolve(restoreBlob(request.result))
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
