import type { ChatInputAttachment, ChatInputDraftTarget } from './chat-input-draft-store'
import { prepareChatInputFile } from '../utils/input-attachments'
import { uploadDraftAttachment, removeDraftAttachment } from './attachment-uploads'
import { errorMessage } from '@/lib/error-message'

export async function stageChatInputFiles(input: {
  addAttachments: (target: ChatInputDraftTarget, images: readonly ChatInputAttachment[]) => number
  updateAttachment: (id: string, update: Partial<ChatInputAttachment>) => boolean
  draftTarget: ChatInputDraftTarget
  existingCount: number
  files: readonly File[]
  onError: (error: string | null) => void
}) {
  let count = input.existingCount
  for (const file of input.files) {
    const prepared = await prepareChatInputFile(file, count)
    if (prepared.status === 'reject') {
      input.onError(prepared.message)
      continue
    }
    const attachment = {
      ...prepared.attachment,
      upload: { status: 'uploading' as const, progress: 0 },
    }
    if (!input.addAttachments(input.draftTarget, [attachment])) {
      input.onError('The attachment limit was reached.')
      continue
    }
    count += 1
    await uploadStagedAttachment({ ...input, attachment, blob: prepared.blob })
  }
}
export async function uploadStagedAttachment(input: {
  draftTarget: ChatInputDraftTarget
  attachment: ChatInputAttachment
  blob?: Blob
  updateAttachment: (id: string, update: Partial<ChatInputAttachment>) => boolean
  onError: (error: string | null) => void
}) {
  const { attachment, updateAttachment } = input
  updateAttachment(attachment.id, { upload: { status: 'uploading', progress: 0 } })
  try {
    const result = await uploadDraftAttachment({
      environmentId: input.draftTarget.environmentId,
      attachment,
      blob: input.blob,
      onProgress: (progress) =>
        updateAttachment(attachment.id, { upload: { status: 'uploading', progress } }),
    })
    const retained = updateAttachment(attachment.id, {
      previewUrl: result.previewUrl,
      dataUrl: undefined,
      upload: { status: 'ready', attachment: result.attachment, expiresAt: result.expiresAt },
    })
    if (!retained)
      await removeDraftAttachment(input.draftTarget.environmentId, attachment.id, result.attachment)
    input.onError(null)
  } catch (error) {
    const message = errorMessage(error, 'Attachment upload failed.')
    if (updateAttachment(attachment.id, { upload: { status: 'failed', message } }))
      input.onError(message)
  }
}
