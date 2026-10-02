import { useQuery } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchPullRequestActivity } from '@/features/git/utils/api'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'

export function usePullRequestActivity(rootPath: string, number: number, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestDiscussionKeys.activity(rootPath, number),
    queryFn: ({ signal, client }) =>
      fetchPullRequestActivity(rootPath, number, signal, clientForQueryClient(client)),
    enabled,
    retry: false,
  })
}
