import { createClientInvariantError } from '@/lib/structured-errors'

const DATABASE = 'platform-editor-history'
// Split so a budget or expiry pass reads a few numbers per file, never the histories.
const META = 'meta'
const DATA = 'data'
const SAVED_AT = 'savedAt'

export type StoredHistory = {
  /** Hash of the text the history's current state holds. */
  readonly contentHash: string
  /** The serialized history as JSON: a string clones cheaply and measures itself. */
  readonly data: string
}

type StoredHistoryMeta = {
  readonly id: string
  readonly contentHash: string
  readonly savedAt: number
  readonly size: number
}

let database: Promise<IDBDatabase> | undefined

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DATA)
      request.result.createObjectStore(META, { keyPath: 'id' }).createIndex(SAVED_AT, SAVED_AT)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(createClientInvariantError('Undo history storage is unavailable.', request.error))
  })
  return database
}

function settled(transaction: IDBTransaction, message: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () =>
      reject(createClientInvariantError(message, transaction.error))
  })
}

export async function readStoredHistory(id: string): Promise<StoredHistory | null> {
  const db = await openDatabase()
  const transaction = db.transaction([META, DATA])
  const meta = transaction.objectStore(META).get(id)
  const data = transaction.objectStore(DATA).get(id)
  await settled(transaction, 'The stored undo history could not be read.')

  const stored = meta.result as StoredHistoryMeta | undefined
  if (!stored || typeof data.result !== 'string') return null
  return { contentHash: stored.contentHash, data: data.result }
}

/** Returns false when the history alone exceeds the budget and was not stored. */
export async function writeStoredHistory(
  id: string,
  history: StoredHistory,
  options: { readonly budget: number; readonly now: number },
): Promise<boolean> {
  const size = history.data.length
  if (size > options.budget) {
    await deleteStoredHistory(id)
    return false
  }

  const db = await openDatabase()
  const transaction = db.transaction([META, DATA], 'readwrite')
  const meta: StoredHistoryMeta = {
    id,
    contentHash: history.contentHash,
    savedAt: options.now,
    size,
  }
  transaction.objectStore(META).put(meta)
  transaction.objectStore(DATA).put(history.data, id)
  trim(transaction, { budget: options.budget, expiredBefore: 0 })
  await settled(transaction, 'The undo history could not be stored.')
  return true
}

export async function deleteStoredHistory(id: string) {
  const db = await openDatabase()
  const transaction = db.transaction([META, DATA], 'readwrite')
  transaction.objectStore(META).delete(id)
  transaction.objectStore(DATA).delete(id)
  await settled(transaction, 'The stored undo history could not be removed.')
}

export async function pruneStoredHistories(options: {
  readonly budget: number
  readonly expiredBefore: number
}): Promise<number> {
  const db = await openDatabase()
  const transaction = db.transaction([META, DATA], 'readwrite')
  const removed = trim(transaction, options)
  await settled(transaction, 'Stored undo histories could not be pruned.')
  return removed.count
}

// Newest first: a record is kept while it is fresh and the running total still fits.
function trim(
  transaction: IDBTransaction,
  options: { readonly budget: number; readonly expiredBefore: number },
) {
  const removed = { count: 0 }
  const meta = transaction.objectStore(META)
  const data = transaction.objectStore(DATA)
  const cursorRequest = meta.index(SAVED_AT).openCursor(null, 'prev')
  let total = 0
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (!cursor) return

    const record = cursor.value as StoredHistoryMeta
    total += record.size
    if (record.savedAt < options.expiredBefore || total > options.budget) {
      total -= record.size
      removed.count += 1
      cursor.delete()
      data.delete(record.id)
    }
    cursor.continue()
  }
  return removed
}
