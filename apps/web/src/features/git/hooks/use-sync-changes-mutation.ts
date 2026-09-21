import { admitGitMutation } from '@/features/git/utils/admit-mutation'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { syncRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { useWorkspaceInvalidation } from './use-workspace-invalidation'

export function useSyncChangesMutation(rootPath: string) {
  const invalidate = useWorkspaceInvalidation()

  return useMutation({
    mutationFn: async (_variables, { client }) => {
      await admitGitMutation(client, rootPath, undefined)
      return syncRemote(rootPath, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.sync(rootPath),
    onError: notifyMutationError,
    onSuccess: invalidate,
  })
}
