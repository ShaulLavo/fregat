import * as v from 'valibot'
import { chatAttachmentSchema } from '@workspace/contracts'

const attachmentUploadStateSchema = v.variant('status', [
  v.object({ status: v.literal('uploading'), progress: v.number() }),
  v.object({ status: v.literal('failed'), message: v.string() }),
  v.object({ status: v.literal('ready'), attachment: chatAttachmentSchema, expiresAt: v.string() }),
])
export const persistedAttachmentDraftSchema = v.intersect([
  chatAttachmentSchema,
  v.object({ previewUrl: v.string(), upload: attachmentUploadStateSchema }),
])
export type ChatInputAttachment = v.InferOutput<typeof chatAttachmentSchema> & {
  dataUrl?: string
  previewUrl: string
  upload?: v.InferOutput<typeof attachmentUploadStateSchema>
}
export function attachmentDraftBlocked(attachment: ChatInputAttachment) {
  return attachment.upload !== undefined && attachment.upload.status !== 'ready'
}
