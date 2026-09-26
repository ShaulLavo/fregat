import { usePushPending } from '@/features/git/hooks/use-push-pending'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { pushRemote } from '@/features/git/utils/api'
import { gitRemoteMutationScope, mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'

export function usePushRemoteMutation(rootPath: string) {
  const isPending = usePushPending(rootPath)
  const mutation = useMutation({
    scope: gitRemoteMutationScope(rootPath),
    mutationFn: (_variables, { client }) => pushRemote(rootPath, clientForQueryClient(client)),
    mutationKey: mutationKeys.push(rootPath),
    onError: notifyMutationError,
    onSuccess: (_result, _variables, _onMutateResult, { client }) =>
      invalidateWorkspace(client, rootPath),
  })
  return { ...mutation, isPending }
}
