import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isolatedDatabase } from '../../../../test/factories/indexed-db'
import {
  deleteAttachmentBlob,
  readAttachmentBlob,
  storeAttachmentBlob,
} from '../state/attachment-blobs'

let database: ReturnType<typeof isolatedDatabase>
beforeEach(() => {
  database = isolatedDatabase('platform-chat-attachment-blobs')
})
afterEach(async () => {
  await database.dispose()
  vi.restoreAllMocks()
})

test('attachment writes settle after commit and round-trip real blobs', async () => {
  await readAttachmentBlob('missing')
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
  await storeAttachmentBlob('one', new Blob(['fixture bytes']))
  expect(committed).toBe(true)
  expect(await (await readAttachmentBlob('one'))?.text()).toBe('fixture bytes')
  await deleteAttachmentBlob('one')
  expect(await readAttachmentBlob('one')).toBeNull()
})

test('the staged-byte budget rejects an oversized blob without storing it', async () => {
  const part = new Blob([new Uint8Array(1024 * 1024)])
  const oversized = new Blob([...Array.from({ length: 400 }, () => part), 'x'])
  await expect(storeAttachmentBlob('large', oversized)).rejects.toThrow(
    'Attachment recovery storage is full.',
  )
  expect(await readAttachmentBlob('large')).toBeNull()
  await storeAttachmentBlob('small', new Blob(['retained']))
  expect(await (await readAttachmentBlob('small'))?.text()).toBe('retained')
  const fullBudget = new Blob(Array.from({ length: 400 }, () => part))
  await expect(storeAttachmentBlob('aggregate', fullBudget)).rejects.toThrow(
    'Attachment recovery storage is full.',
  )
  expect(await readAttachmentBlob('aggregate')).toBeNull()
  expect(await (await readAttachmentBlob('small'))?.text()).toBe('retained')
})

test('an aborted removal rejects and preserves the stored attachment', async () => {
  await storeAttachmentBlob('one', new Blob(['retained']))
  const remove = IDBObjectStore.prototype.delete
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(
    function (this: IDBObjectStore, key) {
      const request = remove.call(this, key)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    },
  )
  await expect(deleteAttachmentBlob('one')).rejects.toThrow(
    'The staged attachment could not be removed.',
  )
  expect(await (await readAttachmentBlob('one'))?.text()).toBe('retained')
})
