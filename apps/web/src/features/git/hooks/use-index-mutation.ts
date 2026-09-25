import { useMutation, type MutationKey } from '@tanstack/react-query'
import type { GitStatusResult } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { admitIndexWrite } from '@/features/git/utils/admit-mutation'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { settleDiscardedGitStatus, settleGitStatus } from '@/features/git/utils/settle-status'

type IndexWrite = {
  readonly mutationKey: MutationKey
  readonly rootPath: string
  readonly run: (owner: Client) => Promise<GitStatusResult>
  /** Paths the write deletes on disk: confirmed against fresh status first, file caches settled after. */
  readonly discards?: readonly string[]
}

/** A write that answers with the repository's new status, which seeds the cache directly. */
export function useIndexMutation({ discards, mutationKey, rootPath, run }: IndexWrite) {
  const settle = discards ? settleDiscardedGitStatus : settleGitStatus

  return useMutation({
    mutationFn: async (_variables: void, { client }) => {
      await admitIndexWrite(client, rootPath, discards)
      return run(clientForQueryClient(client))
    },
    mutationKey,
    onError: notifyMutationError,
    onSuccess: (status, _variables, _onMutateResult, { client }) =>
      settle(client, rootPath, status),
    // One write per repository at a time: a settled cache has no self-healing
    // refetch, so two responses must not land out of order.
    scope: { id: `git-index:${rootPath}` },
  })
}
