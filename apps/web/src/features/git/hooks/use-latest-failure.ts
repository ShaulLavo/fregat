import { useMutationState } from '@tanstack/react-query'

import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import type { GitFailure } from '@/features/git/utils/failure-prompt'

type LatestFailure = GitFailure & { readonly mutationId: number }

/**
 * The newest git mutation, when it ended in an error. Read from the mutation
 * cache, so a retry that starts or succeeds replaces the failure by itself.
 */
export function useLatestFailure(): LatestFailure | null {
  const mutations = useMutationState({
    filters: { mutationKey: ['git', 'mutation'] },
    select: (mutation) => ({
      error: mutation.state.error,
      mutationId: mutation.mutationId,
      operation: String(mutation.options.mutationKey?.[2] ?? 'command'),
      status: mutation.state.status,
    }),
  })
  const latest = mutations.at(-1)
  if (!latest || latest.status !== 'error') return null

  return {
    message: clientErrorMessage(latest.error),
    mutationId: latest.mutationId,
    operation: latest.operation,
  }
}
