import { queryOptions, skipToken, type QueryClient } from '@tanstack/react-query'
import type {
  ProviderInstanceId,
  ProviderInstanceMcp,
  ProviderMcpAddBody,
  ProviderMcpCopyBody,
  ProviderMcpRemoveBody,
  ProviderMcpSignIn,
} from '@workspace/contracts'

import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/** Each read starts every server once, so it stays fresh for a while and never refetches on focus. */
const MCP_STALE_TIME_MS = 5 * 60_000

export function instanceMcpQueryOptions(
  providerInstanceId: ProviderInstanceId | null,
  folder: string | null,
) {
  return queryOptions({
    queryFn: providerInstanceId
      ? async ({ client, signal }) => {
          const response = await clientForQueryClient(client)
            .providers({ providerInstanceId })
            .mcp.get({ fetch: { signal }, query: folder ? { folder } : {} })
          if (response.error) throw createRpcError(response.error)
          return {
            ...(response.data as ProviderInstanceMcp),
            subject: { providerInstanceId, folder },
          }
        }
      : skipToken,
    queryKey: settingsQueryKeys.mcpServers(providerInstanceId, folder),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: MCP_STALE_TIME_MS,
  })
}

export async function addMcpServer(
  owner: QueryClient,
  providerInstanceId: ProviderInstanceId,
  body: ProviderMcpAddBody,
) {
  const response = await clientForQueryClient(owner)
    .providers({ providerInstanceId })
    .mcp.post(body)
  if (response.error) throw createRpcError(response.error)
}

export async function removeMcpServer(
  owner: QueryClient,
  providerInstanceId: ProviderInstanceId,
  name: string,
  body: ProviderMcpRemoveBody,
) {
  const response = await clientForQueryClient(owner)
    .providers({ providerInstanceId })
    .mcp({ name })
    .delete(body)
  if (response.error) throw createRpcError(response.error)
}

export async function copyMcpServer(
  owner: QueryClient,
  providerInstanceId: ProviderInstanceId,
  name: string,
  body: ProviderMcpCopyBody,
) {
  const response = await clientForQueryClient(owner)
    .providers({ providerInstanceId })
    .mcp({ name })
    .copy.post(body)
  if (response.error) throw createRpcError(response.error)
}

export async function signInMcpServer(
  owner: QueryClient,
  providerInstanceId: ProviderInstanceId,
  name: string,
  folder: string | null,
) {
  const response = await clientForQueryClient(owner)
    .providers({ providerInstanceId })
    .mcp({ name })
    ['sign-in'].post({ folder })
  if (response.error) throw createRpcError(response.error)
  return response.data as ProviderMcpSignIn
}

/** A write changes what the next probe reports, for the instance written and any copy target. */
export function settleMcpQueries(owner: QueryClient) {
  return owner.invalidateQueries({ queryKey: settingsQueryKeys.mcpServersAll })
}
