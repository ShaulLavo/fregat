import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { unstagePaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { settleGitStatus } from '@/features/git/utils/settle-status'

export function useUnstagePathsMutation(paths: readonly string[], rootPath: string) {
  return useMutation({
    mutationFn: (_variables, { client }) => unstagePaths(paths, clientForQueryClient(client)),
    mutationKey: mutationKeys.unstageMany(paths),
    onError: notifyMutationError,
    onSuccess: (status, _variables, _onMutateResult, { client }) =>
      settleGitStatus(client, rootPath, status),
    // One write per repository at a time: a settled cache has no self-healing
    // refetch, so two responses must not land out of order.
    scope: { id: `git-index:${rootPath}` },
  })
}
