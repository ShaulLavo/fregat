import { useMutation, type MutationKey, type MutationScope } from '@tanstack/react-query'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { invalidateWorkspace } from '@/features/git/utils/invalidate-workspace'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'

type RemoteWrite<T> = {
  readonly mutationKey: MutationKey
  readonly rootPath: string
  readonly run: (rootPath: string, owner: Client) => Promise<T>
  readonly scope?: MutationScope
  /** `checkout` refetches only this checkout's git queries; the default refetches every repository's. */
  readonly refetch?: 'checkout' | 'workspace'
  /** Runs before the refetch starts. */
  readonly onSuccess?: () => void
}

/** A write whose effects reach past the status it could return, so the workspace refetches. */
export function useRemoteMutation<T>({
  mutationKey,
  onSuccess,
  refetch = 'workspace',
  rootPath,
  run,
  scope,
}: RemoteWrite<T>) {
  return useMutation({
    mutationFn: async (_variables: void, { client }) => {
      admitGitWrite(client)
      return run(rootPath, clientForQueryClient(client))
    },
    mutationKey,
    onError: notifyMutationError,
    onSuccess: (_result, _variables, _onMutateResult, { client }) => {
      onSuccess?.()
      return invalidateWorkspace(client, refetch === 'checkout' ? rootPath : undefined)
    },
    scope,
  })
}
