import { admitDiscard } from '@/features/git/utils/admit-mutation'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { discardPaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { settleDiscardedGitStatus } from '@/features/git/utils/settle-status'

export function useDiscardPathsMutation(paths: readonly string[], rootPath: string) {
  return useMutation({
    mutationFn: async (_variables, { client }) => {
      await admitDiscard(client, rootPath, paths)
      return discardPaths(paths, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.discard(rootPath, paths),
    onError: notifyMutationError,
    onSuccess: (status, _variables, _onMutateResult, { client }) =>
      settleDiscardedGitStatus(client, rootPath, status),
    // One write per repository at a time: a settled cache has no self-healing
    // refetch, so two responses must not land out of order.
    scope: { id: `git-index:${rootPath}` },
  })
}
