import { queryOptions } from '@tanstack/react-query'

import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { gitKeys } from '@/lib/query-keys'

const BRANCHES_STALE_TIME_MS = 30_000

/** Local branches of the repository at `path`, for picking where a new worktree starts. */
export function branchesQueryOptions(path: string) {
  return queryOptions({
    queryKey: gitKeys.branches(path),
    queryFn: ({ client, signal }) => fetchBranches(path, signal, clientForQueryClient(client)),
    staleTime: BRANCHES_STALE_TIME_MS,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

async function fetchBranches(path: string, signal: AbortSignal, client: Client) {
  return observeClientOperation(
    { ...clientLogContext(client), area: 'git', action: 'git.branches', path, signal },
    async () => {
      const [response, worktreesResponse] = await Promise.all([
        client.git.branches.get({ query: { path }, fetch: { signal } }),
        client.git.worktrees.get({ query: { path }, fetch: { signal } }),
      ])
      // Worktrees only draw the lane gutter; without them the branches still list, unlaned.
      const worktrees = worktreesResponse.error ? [] : (worktreesResponse.data ?? [])
      const branches = unwrapEdenResponse(response, {
        requireData: true,
        emptyMessage: 'git server returned an empty response',
      })
      return { ...branches, worktrees }
    },
    (result) => ({
      branchCount: result.branches.length,
      worktreeCount: result.worktrees.length,
      hasRepository: result.repository !== null,
    }),
  )
}
