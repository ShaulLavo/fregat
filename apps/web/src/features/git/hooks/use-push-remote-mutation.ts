import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'
import { playFeedback } from '@workspace/ui/patterns/feedback-layer'

import { pushRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { useWorkspaceInvalidation } from './use-workspace-invalidation'

export function usePushRemoteMutation(rootPath: string) {
  const invalidate = useWorkspaceInvalidation()

  return useMutation({
    mutationFn: (_variables, { client }) => pushRemote(rootPath, clientForQueryClient(client)),
    mutationKey: mutationKeys.push(rootPath),
    onError: notifyMutationError,
    onSuccess: () => {
      playFeedback('success', 'git')
      return invalidate()
    },
  })
}
