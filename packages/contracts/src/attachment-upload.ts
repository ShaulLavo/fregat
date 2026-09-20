import * as v from 'valibot'
import {
  chatAttachmentSchema,
  chatFileAttachmentSchema,
  chatImageAttachmentSchema,
} from './chat-model'

export const attachmentUploadInputSchema = v.variant('type', [
  v.omit(chatImageAttachmentSchema, ['id']),
  v.omit(chatFileAttachmentSchema, ['id']),
])
export const attachmentUploadTicketSchema = v.object({
  attachment: chatAttachmentSchema,
  expiresAt: v.string(),
  uploadPath: v.string(),
})
export type AttachmentUploadInput = v.InferOutput<typeof attachmentUploadInputSchema>
export type AttachmentUploadTicket = v.InferOutput<typeof attachmentUploadTicketSchema>
