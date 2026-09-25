import { useAttachmentCapabilities } from './use-attachment-capabilities'
import type { ChatInputAttachment } from '../state/chat-input-draft-store'
import { errorMessage } from '@/lib/error-message'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { stageChatInputFiles, uploadStagedAttachment } from '../state/prepare-attachments'
import { cancelAttachmentUpload, removeDraftAttachment } from '../state/attachment-uploads'
import {
  chatInputAttachmentsPreparing,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '../state/chat-input-draft-store'
import { attachmentDraftBlocked } from '../utils/attachment-draft'
import { chatMutationKeys } from '../utils/mutation-keys'

export function useAttachmentPreparation(target: ChatInputDraftTarget) {
  const capabilities = useAttachmentCapabilities(target.environmentId)
  const hasFiles = useChatInputDraftStore((state) =>
    state.getDraft(target).attachments.some((entry) => entry.type === 'file'),
  )
  const filesBlocked = hasFiles && capabilities.data?.files !== true
  const preparing = useChatInputDraftStore((state) => chatInputAttachmentsPreparing(state, target))
  const blocked = useChatInputDraftStore((state) =>
    state.getDraft(target).attachments.some(attachmentDraftBlocked),
  )
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationKey: chatMutationKeys.attachments(target.environmentId, target.draftKey),
    scope: { id: `attachments:${target.environmentId}:${target.draftKey}` },
    mutationFn: async (
      input: { files: readonly File[] } | { retry: string } | { remove: ChatInputAttachment },
    ) => {
      const drafts = useChatInputDraftStore.getState()
      const updateAttachment = (
        id: string,
        update: Parameters<typeof drafts.updateAttachment>[2],
      ) => drafts.updateAttachment(target, id, update)
      if ('files' in input)
        return stageChatInputFiles({
          addAttachments: drafts.addAttachments,
          updateAttachment,
          draftTarget: target,
          existingCount: drafts.getDraft(target).attachments.length,
          files: input.files,
          onError: setError,
        })
      const attachment =
        'remove' in input
          ? input.remove
          : drafts.getDraft(target).attachments.find((entry) => entry.id === input.retry)
      if (!attachment) return
      if ('retry' in input)
        return uploadStagedAttachment({
          draftTarget: target,
          attachment,
          updateAttachment,
          onError: setError,
        })
      await removeDraftAttachment(
        target.environmentId,
        attachment.id,
        attachment.upload?.status === 'ready' ? attachment.upload.attachment : undefined,
      )
    },
    onMutate: (input) => {
      if (!('remove' in input)) return
      cancelAttachmentUpload(target.environmentId, input.remove.id)
      useChatInputDraftStore.getState().removeAttachment(target, input.remove.id)
    },
    onError: (error) => setError(errorMessage(error, 'Attachment operation failed.')),
    onSettled: (_data, _error, input) => {
      if (!('remove' in input))
        useChatInputDraftStore.getState().changeAttachmentPreparation(target, -1)
    },
  })
  const start = (input: Parameters<typeof mutation.mutate>[0]) => {
    // A removal has already left the draft, so its server delete must not hold up send or stash.
    if (!('remove' in input))
      useChatInputDraftStore.getState().changeAttachmentPreparation(target, 1)
    return mutation.mutateAsync(input).then(
      (count) => typeof count === 'number' && count > 0,
      () => false,
    )
  }
  return {
    error: filesBlocked
      ? 'This environment cannot currently accept files. Your draft is preserved.'
      : error,
    preparing: preparing || blocked || filesBlocked,
    isPreparing: () =>
      filesBlocked ||
      chatInputAttachmentsPreparing(useChatInputDraftStore.getState(), target) ||
      useChatInputDraftStore.getState().getDraft(target).attachments.some(attachmentDraftBlocked),
    prepare: (files: readonly File[]) => {
      if (!files.length) return Promise.resolve(false)
      return start({ files })
    },
    retry: (id: string) => start({ retry: id }),
    remove: (id: string) => {
      const attachment = useChatInputDraftStore
        .getState()
        .getDraft(target)
        .attachments.find((entry) => entry.id === id)
      if (attachment) start({ remove: attachment })
    },
    clearSent: () => {
      for (const attachment of useChatInputDraftStore.getState().getDraft(target).attachments)
        start({ remove: attachment })
    },
    clearError: () => setError(null),
  }
}
