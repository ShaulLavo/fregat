import type { QueryClient } from '@tanstack/query-core'
import { createClientInvariantError } from '@/lib/structured-errors'
import { resourceQueryKeys } from '../utils/query-keys'
import { resourceQueryClient } from './query-client'

type DatabaseOptions = {
  readonly name: string
  readonly version: number
  readonly initialize: (database: IDBDatabase, event: IDBVersionChangeEvent) => void
  readonly errorMessage: string
}

export function createDatabaseResource(
  options: DatabaseOptions,
  resources: QueryClient = resourceQueryClient,
) {
  const queryKey = resourceQueryKeys.database(options.name, options.version)

  function forget(database: IDBDatabase) {
    if (resources.getQueryData(queryKey) !== database) return
    resources.removeQueries({ queryKey, exact: true })
  }

  return {
    open: () =>
      resources.query({
        queryKey,
        queryFn: ({ signal }) => openConnection(options, signal, forget),
        staleTime: 'static',
        gcTime: Infinity,
        networkMode: 'always',
        structuralSharing: false,
        retry: false,
      }),
    close() {
      resources.getQueryData<IDBDatabase>(queryKey)?.close()
      // Removing a pending query aborts its signal; a late open closes itself.
      resources.removeQueries({ queryKey, exact: true })
    },
  }
}

function openConnection(
  options: DatabaseOptions,
  signal: AbortSignal,
  forget: (database: IDBDatabase) => void,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(options.name, options.version)
    request.onupgradeneeded = (event) => options.initialize(request.result, event)
    request.onerror = () => reject(createClientInvariantError(options.errorMessage, request.error))
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => closeConnection(database, forget)
      database.onclose = () => forget(database)
      if (signal.aborted) database.close()
      resolve(database)
    }
  })
}

function closeConnection(database: IDBDatabase, forget: (database: IDBDatabase) => void) {
  database.close()
  forget(database)
}
