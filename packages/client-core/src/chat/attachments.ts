import { CHAT_ATTACHMENT_MIME_TYPES, MAX_CHAT_ATTACHMENT_BYTES } from '@workspace/contracts'

const longestPrefix = Math.max(
  ...CHAT_ATTACHMENT_MIME_TYPES.map((type) => `data:${type};base64,`.length),
)

// Both clients budget the complete data URL sent to the provider.
export const MAX_CHAT_ATTACHMENT_ENCODED_BYTES =
  3 * Math.floor((MAX_CHAT_ATTACHMENT_BYTES - longestPrefix) / 4)
export const CHAT_ATTACHMENT_SIZE_LABEL = `${MAX_CHAT_ATTACHMENT_ENCODED_BYTES.toLocaleString('en-US')} bytes`

export function chatAttachmentDataUrlLength(byteLength: number, mimeType: string) {
  return `data:${mimeType};base64,`.length + 4 * Math.ceil(byteLength / 3)
}
