import { usePushPending } from '@/features/git/hooks/use-push-pending'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { pushAndOpenPullRequest } from '@/features/git/utils/api'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'
import { gitRemoteMutationScope, mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { shipOutcome } from '@/features/git/utils/ship-outcome'

export function usePushAndOpenPullRequestMutation(rootPath: string, label: string) {
  const isPending = usePushPending(rootPath)
  const mutation = useMutation({
    scope: gitRemoteMutationScope(rootPath),
    mutationFn: async (input: { title: string }, { client }) => {
      admitGitWrite(client)
      return pushAndOpenPullRequest({ ...input, path: rootPath }, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.pushAndOpenPullRequest(rootPath),
    onError: notifyMutationError,
    onSuccess: async (result, _input, _onMutateResult, { client }) => {
      // Upstream, ahead count and the pull request all moved.
      await invalidateWorkspace(client, rootPath)
      const outcome = shipOutcome(result, label)
      if (outcome.tone === 'error') toast.error(outcome.title, { description: outcome.detail })
      else toast.success(outcome.title, { description: outcome.detail })
    },
  })
  return { ...mutation, isPending }
}
