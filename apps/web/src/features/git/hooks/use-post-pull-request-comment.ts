import { useMutation } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { postPullRequestComment } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'

export function usePostPullRequestComment(rootPath: string, number: number) {
  return useMutation({
    mutationKey: mutationKeys.pullRequestComment(rootPath, number),
    scope: { id: JSON.stringify(['git', 'discussion', rootPath, number]) },
    mutationFn: (body: string, { client }) =>
      postPullRequestComment({ path: rootPath, number, body }, clientForQueryClient(client)),
    // The forge may have accepted a write whose response was lost, so refresh on either outcome.
    onSettled: (_data, _error, _body, _result, { client }) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: pullRequestDiscussionKeys.comments(rootPath, number),
        }),
        client.invalidateQueries({
          queryKey: pullRequestDiscussionKeys.activity(rootPath, number),
        }),
      ]),
    retry: false,
  })
}
