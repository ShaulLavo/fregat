import { QueryClient } from '@tanstack/react-query'

import { canonicalServerOrigin } from '@workspace/client-core/transport/client'
import { environmentClientFor, primaryServerOrigin, type Client } from '@/lib/client'
import { installServerRestartInvalidation } from '@/lib/environments/state/server-restart-invalidation'
import {
  createQueryClientOwnerConflictError,
  createQueryClientOwnerMissingError,
} from '@workspace/client-core/environments/utils/structured-errors'
import { installFileSnapshotQueryCachePolicy } from '@/lib/file-snapshot-query-cache'

type QueryClientOwner = {
  readonly client: Client
  readonly origin: string
}

const queryClients = new Map<string, QueryClient>()
const owners = new WeakMap<QueryClient, QueryClientOwner>()

export function primaryQueryClient(): QueryClient {
  return queryClientFor(primaryServerOrigin())
}

export function queryClientFor(origin: string): QueryClient {
  origin = canonicalServerOrigin(origin)
  const existing = queryClients.get(origin)
  if (existing) return existing

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        retry: 1,
        staleTime: 10 * 1000,
      },
    },
  })
  registerEnvironmentQueryClient(queryClient, origin)
  installFileSnapshotQueryCachePolicy(queryClient)
  installServerRestartInvalidation(queryClient, origin)
  queryClients.set(origin, queryClient)
  return queryClient
}

export function registerEnvironmentQueryClient(
  queryClient: QueryClient,
  origin: string,
  client: Client = environmentClientFor(origin),
): void {
  origin = canonicalServerOrigin(origin)
  const owner = owners.get(queryClient)
  if (!owner) {
    owners.set(queryClient, { client, origin })
    return
  }
  if (owner.origin !== origin) throw createQueryClientOwnerConflictError(owner.origin, origin)
  // Same origin, different transport: that is a client swap against the same
  // server, so the cache stays coherent. It is how `setClient` reaches queries
  // that resolve through this registry rather than through `getClient()`.
  if (owner.client !== client) owners.set(queryClient, { client, origin })
}
//TODO clientForQueryClient and originForQueryClient are confusing just call and destructure ownerForQueryClient everywhere
export function clientForQueryClient(queryClient: QueryClient): Client {
  return ownerForQueryClient(queryClient).client
}

export function originForQueryClient(queryClient: QueryClient): string {
  return ownerForQueryClient(queryClient).origin
}

function ownerForQueryClient(queryClient: QueryClient): QueryClientOwner {
  const owner = owners.get(queryClient)
  if (owner) return owner

  throw createQueryClientOwnerMissingError()
}
