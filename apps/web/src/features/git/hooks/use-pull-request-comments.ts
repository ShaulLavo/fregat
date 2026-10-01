import { useQuery } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchPullRequestComments } from '@/features/git/utils/api'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'

export function usePullRequestComments(rootPath: string, number: number, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestDiscussionKeys.comments(rootPath, number),
    queryFn: ({ signal, client }) =>
      fetchPullRequestComments(rootPath, number, signal, clientForQueryClient(client)),
    enabled,
    retry: false,
  })
}
