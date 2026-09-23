import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { unstagePath } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { settleGitStatus } from '@/features/git/utils/settle-status'

export function useUnstagePathMutation(path: string, rootPath: string) {
  return useMutation({
    mutationFn: async (_variables, { client }) => {
      admitGitWrite(client)
      return unstagePath(path, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.unstage(rootPath, path),
    onError: notifyMutationError,
    onSuccess: (status, _variables, _onMutateResult, { client }) =>
      settleGitStatus(client, rootPath, status),
    // One write per repository at a time: a settled cache has no self-healing
    // refetch, so two responses must not land out of order.
    scope: { id: `git-index:${rootPath}` },
  })
}
