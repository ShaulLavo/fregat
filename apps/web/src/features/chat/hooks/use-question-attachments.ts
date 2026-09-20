import { useAttachmentCapabilities } from './use-attachment-capabilities'
import type { ChatInputAttachment } from '../state/chat-input-draft-store'
import { errorMessage } from '@/lib/error-message'
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { UserInputAttachmentUploads } from '@workspace/contracts'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { stageChatInputFiles, uploadStagedAttachment } from '../state/prepare-attachments'
import { cancelAttachmentUpload, removeDraftAttachment } from '../state/attachment-uploads'
import { chatInputUploadAttachments } from '../utils/input-attachments'
import { attachmentDraftBlocked } from '../utils/attachment-draft'
import { chatMutationKeys } from '../utils/mutation-keys'

export function useQuestionAttachments(
  sessionId: string,
  requestId: string,
  questionIds: readonly string[],
) {
  const pendingCount = useRef(0)
  const environmentId = useEnvironmentId()
  const capabilities = useAttachmentCapabilities(environmentId)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const drafts = useChatInputDraftStore()
  const target = (questionId: string): ChatInputDraftTarget => ({
    environmentId,
    rootPath: '',
    draftKey: `${sessionId}:question:${requestId}:${questionId}`,
  })
  const byQuestion = Object.fromEntries(
    questionIds.map((id) => [id, drafts.getDraft(target(id)).attachments]),
  )
  const mutation = useMutation({
    mutationKey: chatMutationKeys.questionAttachments(environmentId, sessionId, requestId),
    scope: { id: `question-attachments:${environmentId}:${sessionId}:${requestId}` },
    mutationFn: async (input: {
      questionId: string
      files?: readonly File[]
      retry?: string
      remove?: ChatInputAttachment
    }) => {
      const current = useChatInputDraftStore.getState()
      const draftTarget = target(input.questionId)
      const updateAttachment = (
        id: string,
        update: Parameters<typeof current.updateAttachment>[2],
      ) => current.updateAttachment(draftTarget, id, update)
      const onError = (message: string | null) =>
        setErrors((previous) => ({ ...previous, [input.questionId]: message }))
      if (input.files)
        return stageChatInputFiles({
          draftTarget,
          files: input.files,
          addAttachments: current.addAttachments,
          updateAttachment,
          onError,
          existingCount: questionIds.reduce(
            (count, id) => count + current.getDraft(target(id)).attachments.length,
            0,
          ),
        })
      const attachment =
        input.remove ??
        current.getDraft(draftTarget).attachments.find((entry) => entry.id === input.retry)
      if (!attachment) return
      if (input.retry)
        return uploadStagedAttachment({ attachment, draftTarget, updateAttachment, onError })
      await removeDraftAttachment(
        environmentId,
        attachment.id,
        attachment.upload?.status === 'ready' ? attachment.upload.attachment : undefined,
      )
    },
    onMutate: (input) => {
      if (!input.remove) return
      cancelAttachmentUpload(environmentId, input.remove.id)
      useChatInputDraftStore.getState().removeAttachment(target(input.questionId), input.remove.id)
    },
    onError: (error, input) =>
      setErrors((previous) => ({
        ...previous,
        [input.questionId]: errorMessage(error, 'Attachment operation failed.'),
      })),
    onSettled: () => {
      pendingCount.current -= 1
    },
  })
  const start = (input: Parameters<typeof mutation.mutate>[0]) => {
    pendingCount.current += 1
    mutation.mutate(input)
  }
  const filesBlocked =
    Object.values(byQuestion)
      .flat()
      .some((entry) => entry.type === 'file') && capabilities.data?.files !== true
  const blocked = Object.values(byQuestion).flat().some(attachmentDraftBlocked)
  const uploads = (): UserInputAttachmentUploads =>
    Object.fromEntries(
      questionIds.map((id) => [
        id,
        chatInputUploadAttachments(
          useChatInputDraftStore.getState().getDraft(target(id)).attachments,
        ),
      ]),
    )
  return {
    byQuestion,
    errors: filesBlocked
      ? Object.fromEntries(
          questionIds.map((id) => [
            id,
            byQuestion[id]?.some((entry) => entry.type === 'file')
              ? 'Files are unavailable in this environment. Your draft is preserved.'
              : errors[id],
          ]),
        )
      : errors,
    uploads,
    preparing: mutation.isPending,
    blocked: mutation.isPending || blocked || filesBlocked || Object.values(errors).some(Boolean),
    isBlocked: () =>
      filesBlocked ||
      Object.values(errors).some(Boolean) ||
      pendingCount.current > 0 ||
      questionIds.some((id) =>
        useChatInputDraftStore
          .getState()
          .getDraft(target(id))
          .attachments.some(attachmentDraftBlocked),
      ),
    prepare: (questionId: string, files: readonly File[]) => start({ questionId, files }),
    retry: (questionId: string, id: string) => start({ questionId, retry: id }),
    remove: (questionId: string, id: string) => {
      const attachment = useChatInputDraftStore
        .getState()
        .getDraft(target(questionId))
        .attachments.find((entry) => entry.id === id)
      if (attachment) start({ questionId, remove: attachment })
    },
    clearSent: () => {
      for (const questionId of questionIds) {
        for (const attachment of useChatInputDraftStore.getState().getDraft(target(questionId))
          .attachments)
          start({ questionId, remove: attachment })
      }
    },
    clearError: (questionId: string) =>
      setErrors((previous) => ({ ...previous, [questionId]: null })),
  }
}
