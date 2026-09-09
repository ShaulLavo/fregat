import type { EntryTypeFilter, WorkspaceSearchMatch } from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { collectWorkspaceSearch } from '@workspace/client-core/files/search-client'

const PROJECT_ENTRY_QUERY_LIMIT = 40
const PROJECT_ENTRY_QUERY_STALE_TIME_MS = 15_000

/**
 * How long typing has to pause before a mention search runs. Long enough to
 * swallow a burst of keystrokes, short enough that the list still feels live.
 */
export const PROJECT_ENTRY_SEARCH_DEBOUNCE_MS = 140
const EMPTY_PROJECT_ENTRIES: ProjectEntrySearchResult = {
  entries: [],
  truncated: false,
}

export type ProjectEntrySearchResult = {
  entries: ProjectEntrySearchItem[]
  truncated: boolean
}

type ProjectEntrySearchItem = {
  id: string
  label: string
  path: string
  type: EntryTypeFilter
}

const projectEntryQueryKeys = {
  all: ['chat-project-entries'] as const,
  search: (rootPath: string, query: string, limit: number) =>
    [...projectEntryQueryKeys.all, rootPath, query, limit] as const,
}

type ProjectEntrySearchQueryKey = ReturnType<typeof projectEntryQueryKeys.search>

export function projectEntrySearchQueryOptions(input: {
  enabled?: boolean
  limit?: number
  query: string
  rootPath: string
}) {
  const limit = input.limit ?? PROJECT_ENTRY_QUERY_LIMIT

  return queryOptions<
    ProjectEntrySearchResult,
    Error,
    ProjectEntrySearchResult,
    ProjectEntrySearchQueryKey
  >({
    enabled: (input.enabled ?? true) && input.query.trim().length > 0,
    placeholderData: (previous) => previous ?? EMPTY_PROJECT_ENTRIES,
    queryFn: ({ signal, client }) =>
      searchProjectEntries({ ...input, limit, signal, client: clientForQueryClient(client) }),
    queryKey: projectEntryQueryKeys.search(input.rootPath, input.query, limit),
    staleTime: PROJECT_ENTRY_QUERY_STALE_TIME_MS,
  })
}

async function searchProjectEntries({
  client,
  limit,
  query,
  rootPath,
  signal,
}: {
  client: Client
  limit: number
  query: string
  rootPath: string
  signal: AbortSignal
}): Promise<ProjectEntrySearchResult> {
  const result = await collectWorkspaceSearch(
    {
      caseSensitive: false,
      includeContent: false,
      includeNames: true,
      limit,
      matchMode: 'fuzzy',
      path: rootPath,
      query,
      wholeWord: false,
    },
    signal,
    client,
  )

  return {
    entries: projectEntryItems(result.matches),
    truncated: result.truncated,
  }
}

function projectEntryItems(matches: readonly WorkspaceSearchMatch[]) {
  return matches.map((match) => ({
    id: `path:${match.path}`,
    label: pathBasename(match.path),
    path: match.path,
    type: match.type,
  }))
}

function pathBasename(input: string) {
  const parts = input.split('/').filter(Boolean)

  return parts.at(-1) ?? input
}
