import { vi } from 'vitest'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { resourceQueryKeys } from '@/lib/resources/utils/query-keys'

export function isolatedDatabase(name: string) {
  const isolatedName = `fregat-test-${crypto.randomUUID()}`
  const connections: IDBDatabase[] = []
  const requests: IDBOpenDBRequest[] = []
  const open = indexedDB.open.bind(indexedDB)
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation((requested, version) => {
    if (requested !== name) return open(requested, version)
    const request = open(isolatedName, version)
    requests.push(request)
    request.addEventListener('success', () => connections.push(request.result))
    return request
  })
  return {
    name: isolatedName,
    requests,
    connections,
    async dispose() {
      spy.mockRestore()
      for (const database of connections) database.close()
      resourceQueryClient.removeQueries({
        queryKey: resourceQueryKeys.database(name, 1),
        exact: true,
      })
      await deleteFixtureDatabase(isolatedName)
    },
  }
}

export function deleteFixtureDatabase(name: string) {
  if (!name.startsWith('fregat-test-')) throw new Error(`Unexpected fixture database: ${name}`)
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
