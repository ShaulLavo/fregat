import { useIsMutating, useMutation, useQueryClient, type Mutation } from '@tanstack/react-query'

import { useNavigation } from '@/hooks/use-navigation'
import { errorMessage } from '@/lib/error-message'
import type { ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { moveDraft, type DraftDestination } from '../state/move-draft'
import { chatMutationKeys } from '../utils/mutation-keys'
import { toastError } from '@/lib/toast-error'

export function useMoveDraft(from: ChatInputDraftTarget) {
  const navigation = useNavigation()
  const queryClient = useQueryClient()
  const mutationKey = chatMutationKeys.moveDraft(from.environmentId, from.draftKey)
  const filters = {
    mutationKey,
    exact: true,
    predicate: (mutation: Mutation) =>
      !mutation.state.isPaused ||
      (mutation.state.variables as DraftDestination | undefined)?.machineSelection !== 'automatic',
  }
  const running = useIsMutating(filters)
  const mutation = useMutation({
    mutationKey,
    scope: { id: 'draft-move' },
    mutationFn: (destination: DraftDestination) => moveDraft(navigation, from, destination),
    onError: (error) => toastError(errorMessage(error, 'Could not move this draft.')),
  })
  return {
    ...mutation,
    isPending: mutation.isPending || running > 0,
    isMoving: running > 0,
    // Read the cache in handlers too: an already-open picker can precede the observer update.
    canChange: () => queryClient.isMutating(filters) === 0,
  }
}
