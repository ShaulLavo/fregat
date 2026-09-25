import { useMutation, type MutationKey } from '@tanstack/react-query'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'

type RemoteWrite<T> = {
  readonly mutationKey: MutationKey
  readonly rootPath: string
  readonly run: (rootPath: string, owner: Client) => Promise<T>
}

/** A write whose effects reach past the status it could return, so the workspace refetches. */
export function useRemoteMutation<T>({ mutationKey, rootPath, run }: RemoteWrite<T>) {
  return useMutation({
    mutationFn: async (_variables: void, { client }) => {
      admitGitWrite(client)
      return run(rootPath, clientForQueryClient(client))
    },
    mutationKey,
    onError: notifyMutationError,
    onSuccess: (_result, _variables, _onMutateResult, { client }) => invalidateWorkspace(client),
  })
}
