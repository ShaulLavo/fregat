import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { cloneRepositoryStreaming, type CloneProgress } from '@/features/git/utils/api'
import { cloneMutationKey } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'

export type CloneRequest = {
  readonly source: string
  readonly destination: string
  /** Aborting closes the stream, which stops git and removes what it wrote. */
  readonly signal: AbortSignal
  readonly onProgress: (progress: CloneProgress) => void
}

export function useCloneRepositoryMutation() {
  return useMutation({
    mutationFn: ({ source, destination, signal, onProgress }: CloneRequest, { client }) =>
      cloneRepositoryStreaming(
        { source, destination },
        onProgress,
        signal,
        clientForQueryClient(client),
      ),
    mutationKey: cloneMutationKey,
    onError: (error, request) => {
      // A cancel the user asked for is not a failure to report.
      if (request.signal.aborted) return
      notifyMutationError(error)
    },
  })
}
