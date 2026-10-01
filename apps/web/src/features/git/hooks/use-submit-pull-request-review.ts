import { useMutation } from '@tanstack/react-query'
import type { GitPullRequestReviewInput } from '@workspace/contracts'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { submitPullRequestReview } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'
import { gitKeys } from '@/lib/query-keys'

export function useSubmitPullRequestReview(rootPath: string, number: number) {
  return useMutation({
    mutationKey: mutationKeys.pullRequestReview(rootPath, number),
    scope: { id: JSON.stringify(['git', 'discussion', rootPath, number]) },
    mutationFn: (input: GitPullRequestReviewInput, { client }) =>
      submitPullRequestReview({ ...input, path: rootPath, number }, clientForQueryClient(client)),
    // A summary can arrive before a verdict fails; settle both reads before releasing the next write.
    onSettled: (_data, _error, _input, _result, { client }) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: pullRequestDiscussionKeys.comments(rootPath, number),
        }),
        client.invalidateQueries({ queryKey: gitKeys.pullRequestState(rootPath) }),
      ]),
    retry: false,
  })
}
