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

/** A file on the server's own disk, named by its filesystem path, to stage as an attachment. */
export const machineFileAttachInputSchema = v.object({ path: v.string() })
/** The staged attachment: its bytes are already on the server, so nothing is left to upload. */
export const machineFileAttachmentSchema = v.object({
  attachment: chatAttachmentSchema,
  expiresAt: v.string(),
})
export type MachineFileAttachInput = v.InferOutput<typeof machineFileAttachInputSchema>
export type MachineFileAttachment = v.InferOutput<typeof machineFileAttachmentSchema>
