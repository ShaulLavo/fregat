import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isolatedDatabase } from '../../../../test/factories/indexed-db'
import {
  deleteStoredHistory,
  pruneStoredHistories,
  readStoredHistory,
  writeStoredHistory,
} from '../state/history-store'

let database: ReturnType<typeof isolatedDatabase>
beforeEach(() => {
  database = isolatedDatabase('platform-editor-history')
})
afterEach(async () => {
  await database.dispose()
  vi.restoreAllMocks()
})

const history = { contentHash: 'fixture-hash', data: '12345' }

test('a failed history open can retry and concurrent readers share acquisition', async () => {
  const first = readStoredHistory('missing')
  database.requests[0]?.addEventListener('upgradeneeded', () =>
    database.requests[0]?.transaction?.abort(),
  )
  await expect(first).rejects.toThrow('Undo history storage is unavailable.')
  const result = await Promise.all([readStoredHistory('one'), readStoredHistory('two')])
  expect(result).toEqual([null, null])
  expect(database.requests).toHaveLength(2)
})

test('history writes settle after commit and preserve budget and expiry trimming', async () => {
  await readStoredHistory('missing')
  const db = database.connections[0]!
  const transaction = db.transaction.bind(db)
  let committed = false
  vi.spyOn(db, 'transaction').mockImplementation(
    (...args: Parameters<IDBDatabase['transaction']>) => {
      const result = transaction(...args)
      if (args[1] === 'readwrite')
        result.addEventListener('complete', () => {
          committed = true
        })
      return result
    },
  )
  await writeStoredHistory('older', history, { budget: 10, now: 1 })
  expect(committed).toBe(true)
  await writeStoredHistory('newer', history, { budget: 10, now: 2 })
  await writeStoredHistory('newest', history, { budget: 10, now: 3 })
  expect(await readStoredHistory('older')).toBeNull()
  expect(await readStoredHistory('newer')).toEqual(history)
  expect(await pruneStoredHistories({ budget: 10, expiredBefore: 3 })).toBe(1)
  expect(await readStoredHistory('newer')).toBeNull()
  expect(await readStoredHistory('newest')).toEqual(history)
  expect(await writeStoredHistory('newest', history, { budget: 4, now: 4 })).toBe(false)
  expect(await readStoredHistory('newest')).toBeNull()
  await deleteStoredHistory('missing')
})
