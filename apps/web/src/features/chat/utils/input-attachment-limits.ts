import {
  MAX_CHAT_ATTACHMENTS,
  normalizeChatAttachmentMimeType,
  type ChatAttachmentMimeType,
} from '@workspace/contracts'

// Bound decoding memory before the browser re-encodes the image.
const BYTES_PER_MEGABYTE = 1024 * 1024
export const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * BYTES_PER_MEGABYTE

type ChatImageRejectionReason = 'empty' | 'too-large' | 'too-many' | 'unsupported-type'

export type ChatImageClassification =
  | {
      status: 'accept'
      /** Normalized media type — use this, not `file.type`, downstream. */
      mimeType: ChatAttachmentMimeType
    }
  | { status: 'reject'; reason: ChatImageRejectionReason; message: string }

/**
 * Decides whether `file` can be staged, given how many images are already
 * staged. Rejections carry the sentence shown to the user, so every refusal
 * names its own cause instead of collapsing into one generic error.
 *
 * Note what is *not* rejected here: anything between `MAX_CHAT_ATTACHMENT_BYTES` and
 * `MAX_COMPRESSIBLE_SOURCE_BYTES` is accepted and downscaled instead, so the
 * wire cap never shows up as a refusal the user cannot act on.
 */
export function classifyChatImageFile(file: File, currentCount: number): ChatImageClassification {
  const mimeType = normalizeChatAttachmentMimeType(file.type)
  if (!mimeType) {
    return {
      status: 'reject',
      reason: 'unsupported-type',
      message: 'PNG, JPEG, WebP and GIF only.',
    }
  }
  if (currentCount >= MAX_CHAT_ATTACHMENTS) {
    return {
      status: 'reject',
      reason: 'too-many',
      message: `Up to ${MAX_CHAT_ATTACHMENTS} images per message.`,
    }
  }
  if (file.size <= 0) {
    return { status: 'reject', reason: 'empty', message: 'That image is empty.' }
  }
  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) {
    return {
      status: 'reject',
      reason: 'too-large',
      message: `Images must be under ${MAX_COMPRESSIBLE_SOURCE_BYTES / BYTES_PER_MEGABYTE} MB.`,
    }
  }

  return { status: 'accept', mimeType }
}
