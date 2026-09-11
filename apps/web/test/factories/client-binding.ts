import {
  activeServerOrigin,
  getClient,
  setActiveServerOrigin,
  setClient,
  type Client,
} from '@/lib/client'
import {
  clientForQueryClient,
  queryClientFor,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'

export function installTestClient(client: Client) {
  const origin = activeServerOrigin()
  const previousClient = getClient()
  const queryClient = queryClientFor(origin)
  const previousBoundClient = clientForQueryClient(queryClient)
  // Each temporary server owns different files, even when tests reuse one environment ID.
  queryClient.clear()
  setClient(client)
  registerEnvironmentQueryClient(queryClient, origin, client)
  return () => {
    queryClient.clear()
    registerEnvironmentQueryClient(queryClient, origin, previousBoundClient)
    const activeOrigin = activeServerOrigin()
    setActiveServerOrigin(origin)
    setClient(previousClient)
    setActiveServerOrigin(activeOrigin)
  }
}
