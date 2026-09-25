import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQuery } from '@tanstack/react-query'

import { gitKeys } from '@/lib/query-keys'
import { fetchPullRequestState } from '@/features/git/utils/api'

/**
 * Polled rather than pushed: a pull request changes on GitHub, where nothing
 * tells this app about it. A minute is slow enough to keep `gh` off the machine
 * on every render, and fast enough that a review that landed while the user was
 * reading shows up before they act on the stale answer.
 */
const PULL_REQUEST_POLL_MS = 60_000

export function usePullRequestState(rootPath: string | null) {
  return useQuery({
    enabled: Boolean(rootPath),
    queryFn: ({ signal, client }) =>
      fetchPullRequestState(rootPath ?? '', signal, clientForQueryClient(client)),
    queryKey: gitKeys.pullRequestState(rootPath ?? ''),
    refetchInterval: PULL_REQUEST_POLL_MS,
    // A repository with no GitHub remote, or a machine with no `gh`, answers
    // the same way every time; retrying only pays for the processes again.
    retry: false,
    staleTime: PULL_REQUEST_POLL_MS,
  })
}
