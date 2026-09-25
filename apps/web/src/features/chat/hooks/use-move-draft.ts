import { useMutation } from '@tanstack/react-query'

import { useNavigation } from '@/hooks/use-navigation'
import { errorMessage } from '@/lib/error-message'
import type { ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { moveDraft, type DraftDestination } from '../state/move-draft'
import { chatMutationKeys } from '../utils/mutation-keys'
import { toastError } from '@/lib/toast-error'

export function useMoveDraft(from: ChatInputDraftTarget) {
  const navigation = useNavigation()
  return useMutation({
    mutationKey: chatMutationKeys.moveDraft(from.environmentId, from.draftKey),
    scope: { id: 'draft-move' },
    mutationFn: (destination: DraftDestination) => moveDraft(navigation, from, destination),
    onError: (error) => toastError(errorMessage(error, 'Could not move this draft.')),
  })
}
