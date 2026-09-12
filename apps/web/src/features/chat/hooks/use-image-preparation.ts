import { useRef, useState } from 'react'

import { stageChatInputImageFiles } from '@/features/chat/utils/input-attachments'
import {
  chatInputImagesPreparing,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { errorMessage } from '@/lib/error-message'

export function useImagePreparation(target: ChatInputDraftTarget) {
  const queue = useRef(Promise.resolve())
  const preparing = useChatInputDraftStore((state) => chatInputImagesPreparing(state, target))
  const [error, setError] = useState<string | null>(null)

  function prepare(files: readonly File[]) {
    if (files.length === 0) return
    useChatInputDraftStore.getState().changeImagePreparation(target, 1)
    queue.current = queue.current.then(async () => {
      try {
        const drafts = useChatInputDraftStore.getState()
        await stageChatInputImageFiles({
          addImages: drafts.addImages,
          draftTarget: target,
          existingImageCount: drafts.getDraft(target).images.length,
          files,
          onError: setError,
        })
      } catch (cause) {
        setError(errorMessage(cause, 'Image preparation failed.'))
      } finally {
        useChatInputDraftStore.getState().changeImagePreparation(target, -1)
      }
    })
  }

  return {
    error,
    isPreparing: () => chatInputImagesPreparing(useChatInputDraftStore.getState(), target),
    prepare,
    preparing,
    clearError: () => setError(null),
  }
}
