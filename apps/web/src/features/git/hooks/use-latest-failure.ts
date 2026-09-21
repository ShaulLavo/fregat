import { useMutationState } from '@tanstack/react-query'

import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import { latestUnretriedFailure } from '@/features/git/utils/latest-failure'
import { gitMutationScope } from '@/features/git/utils/mutation-keys'
import type { GitFailure } from '@/features/git/utils/failure-prompt'

type LatestFailure = GitFailure & { readonly mutationId: number }

/**
 * The newest failed git step in this repository that has not been retried. Read
 * from the mutation cache, so running the same step again replaces the failure
 * by itself. Scoped to `rootPath`: the cache is shared by every repository and
 * every session worktree open in the environment.
 */
export function useLatestFailure(rootPath: string): LatestFailure | null {
  const mutations = useMutationState({
    filters: { mutationKey: gitMutationScope(rootPath) },
    select: (mutation) => ({
      error: mutation.state.error,
      key: JSON.stringify(mutation.options.mutationKey ?? []),
      mutationId: mutation.mutationId,
      operation: String(mutation.options.mutationKey?.[3] ?? 'command'),
      status: mutation.state.status,
    }),
  })
  const failed = latestUnretriedFailure(mutations)
  if (!failed) return null

  return {
    message: clientErrorMessage(failed.error),
    mutationId: failed.mutationId,
    operation: failed.operation,
  }
}
