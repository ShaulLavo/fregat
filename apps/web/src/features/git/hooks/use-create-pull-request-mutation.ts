import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { playFeedback } from '@workspace/ui/patterns/feedback-layer'

import { gitKeys } from '@/lib/query-keys'
import { createPullRequest } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'

export function useCreatePullRequestMutation(rootPath: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (
      input: { base?: string; body?: string; draft?: boolean; title: string },
      { client },
    ) => createPullRequest({ ...input, path: rootPath }, clientForQueryClient(client)),
    mutationKey: mutationKeys.createPullRequest(rootPath),
    onError: notifyMutationError,
    onSuccess: () => {
      playFeedback('success', 'git')
      return queryClient.invalidateQueries({ queryKey: gitKeys.pullRequestState(rootPath) })
    },
  })
}
