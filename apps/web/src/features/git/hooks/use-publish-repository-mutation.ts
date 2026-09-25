import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'
import type { GitPublishRequest } from '@workspace/contracts'
import { toast } from 'sonner'

import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { publishRepository } from '@/features/git/utils/api'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { publishOutcome } from '@/features/git/utils/publish-outcome'

export function usePublishRepositoryMutation(rootPath: string) {
  return useMutation({
    mutationFn: async (request: Omit<GitPublishRequest, 'path'>, { client }) => {
      admitGitWrite(client)
      return publishRepository({ ...request, path: rootPath }, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.publish(rootPath),
    onError: notifyMutationError,
    onSuccess: (result, _request, _onMutateResult, { client }) => {
      // A new remote and upstream change every git read, not only status.
      invalidateWorkspace(client)
      const outcome = publishOutcome(result)
      if (outcome.tone === 'error') toast.error(outcome.title, { description: outcome.detail })
      else toast.success(outcome.title, { description: outcome.detail })
    },
  })
}
