import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import type { GitPublishRequest } from '@workspace/contracts'

import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { announceOutcome } from '@/features/git/utils/announce-outcome'
import { publishRepository } from '@/features/git/utils/api'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'
import { gitRemoteMutationScope, mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { publishOutcome } from '@/features/git/utils/publish-outcome'

export function usePublishRepositoryMutation(rootPath: string) {
  const isPending = useIsMutating({ mutationKey: mutationKeys.publish(rootPath) }) > 0
  const mutation = useMutation({
    scope: gitRemoteMutationScope(rootPath),
    mutationFn: async (request: Omit<GitPublishRequest, 'path'>, { client }) => {
      admitGitWrite(client)
      return publishRepository({ ...request, path: rootPath }, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.publish(rootPath),
    onError: notifyMutationError,
    onSuccess: async (result, _request, _onMutateResult, { client }) => {
      // A new remote and upstream change every git read, not only status.
      await invalidateWorkspace(client, rootPath)
      announceOutcome(publishOutcome(result))
    },
  })
  return { ...mutation, isPending }
}
