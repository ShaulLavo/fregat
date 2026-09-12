import type { QueryClient } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { SettingsValues } from '@workspace/contracts'
import { languageServerMatches } from '@/features/editor/utils/language-server-plugin'
import { createRpcError } from '@/lib/structured-errors'

const LANGUAGE_SERVER_MATCH_STALE_MS = 30_000

type LanguageServerMatchConfiguration = Pick<
  SettingsValues,
  'lsp.experimental.tyForPython' | 'lsp.languageServers' | 'lsp.servers'
>

export type LanguageServerMatchConfigurationSnapshot = {
  readonly configuration: LanguageServerMatchConfiguration
  readonly generation: number
}

export function languageServerMatchQueryOptions(
  rootPath: string,
  matchPath: string,
  snapshot: LanguageServerMatchConfigurationSnapshot,
) {
  return {
    queryFn: async ({
      signal,
      client,
    }: {
      readonly signal: AbortSignal
      readonly client: QueryClient
    }) => {
      const response = await clientForQueryClient(client).lsp.match.get({
        query: { path: matchPath, root: rootPath },
        fetch: { signal },
      })
      if (response.error) throw createRpcError(response.error)

      return languageServerMatches(response.data)
    },
    queryKey: [
      'language-server-matches',
      rootPath,
      matchPath,
      snapshot.generation,
      snapshot.configuration,
    ] as const,
    staleTime: LANGUAGE_SERVER_MATCH_STALE_MS,
  }
}
