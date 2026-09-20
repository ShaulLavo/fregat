import type { QueryClient } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import {
  editorQueryKeys,
  type LanguageServerMatchConfigurationSnapshot,
} from '@/features/editor/utils/query-keys'
import { languageServerMatches } from '@/features/editor/utils/language-server-plugin'
import { createRpcError } from '@/lib/structured-errors'

const LANGUAGE_SERVER_MATCH_STALE_MS = 30_000

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
    queryKey: editorQueryKeys.languageServerMatches(rootPath, matchPath, snapshot),
    staleTime: LANGUAGE_SERVER_MATCH_STALE_MS,
  }
}
