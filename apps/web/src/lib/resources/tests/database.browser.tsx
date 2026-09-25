import { QueryClient } from '@tanstack/query-core'
import { afterEach, expect, test, vi } from 'vitest'
import { deleteFixtureDatabase } from '../../../../test/factories/indexed-db'
import { createDatabaseResource } from '../state/database'
import { resourceQueryKeys } from '../utils/query-keys'

const owners: ReturnType<typeof createDatabaseResource>[] = []
const names: string[] = []
const clients: QueryClient[] = []

function fixture() {
  const name = `fregat-test-${crypto.randomUUID()}`
  const client = new QueryClient()
  names.push(name)
  clients.push(client)
  const options = {
    name,
    version: 1,
    initialize: (db: IDBDatabase) => {
      db.createObjectStore('values')
    },
    errorMessage: 'Fixture acquisition failed.',
  }
  const resource = createDatabaseResource(options, client)
  owners.push(resource)
  return { name, client, options, resource }
}

afterEach(async () => {
  for (const owner of owners.splice(0)) owner.close()
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  await Promise.all(names.splice(0).map(deleteFixtureDatabase))
})

test('failed opening remains an error and concurrent intentional retries share one connection', async () => {
  const { resource, client, name } = fixture()
  const open = indexedDB.open.bind(indexedDB)
  const requests: IDBOpenDBRequest[] = []
  const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce((database, version) => {
    const request = open(database, version)
    requests.push(request)
    return request
  })
  const first = resource.open()
  requests[0]?.addEventListener('upgradeneeded', () => requests[0]?.transaction?.abort())
  await expect(first).rejects.toThrow('Fixture acquisition failed.')
  expect(client.getQueryState(resourceQueryKeys.database(name, 1))?.status).toBe('error')
  const [one, two] = await Promise.all([resource.open(), resource.open()])
  expect(one).toBe(two)
  expect(spy).toHaveBeenCalledTimes(2)
  expect(one.objectStoreNames.contains('values')).toBe(true)
})

test('version changes retire the old handle and the new version can close and reacquire', async () => {
  const { resource, client, name, options } = fixture()
  const first = await resource.open()
  const upgraded = createDatabaseResource(
    {
      ...options,
      version: 2,
      initialize: (db) => {
        db.createObjectStore('extra')
      },
    },
    client,
  )
  owners.push(upgraded)
  const next = await upgraded.open()
  expect(next.version).toBe(2)
  expect(client.getQueryData(resourceQueryKeys.database(name, 1))).toBeUndefined()
  expect(() => first.transaction('values')).toThrow()
  expect(await upgraded.open()).toBe(next)
  upgraded.close()
  expect(client.getQueryData(resourceQueryKeys.database(name, 2))).toBeUndefined()
  const reopened = await upgraded.open()
  expect(reopened).not.toBe(next)
  expect(reopened.objectStoreNames.contains('extra')).toBe(true)
})

test('closing during acquisition disposes the late connection without caching it', async () => {
  const { resource, client, name } = fixture()
  const open = indexedDB.open.bind(indexedDB)
  const connections: IDBDatabase[] = []
  vi.spyOn(indexedDB, 'open').mockImplementation((database, version) => {
    const request = open(database, version)
    request.addEventListener('success', () => connections.push(request.result))
    return request
  })
  const pending = resource.open().catch(() => null)
  resource.close()
  await pending
  await vi.waitFor(() => expect(connections).toHaveLength(1))
  expect(() => connections[0]?.transaction('values')).toThrow()
  expect(client.getQueryData(resourceQueryKeys.database(name, 1))).toBeUndefined()
  expect(await resource.open()).not.toBe(connections[0])
})
