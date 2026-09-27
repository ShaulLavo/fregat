import { imageSourceMimeType } from './image-source'
import { MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'

// Bound decoding memory before the browser re-encodes the image.
const BYTES_PER_MEGABYTE = 1024 * 1024
export const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * BYTES_PER_MEGABYTE

type ChatImageRejectionReason = 'empty' | 'too-large' | 'too-many' | 'unsupported-type'

export type ChatImageClassification =
  | {
      status: 'accept'
      // Source formats outside the provider allowlist are converted before upload.
      mimeType: NonNullable<ReturnType<typeof imageSourceMimeType>>
    }
  | { status: 'reject'; reason: ChatImageRejectionReason; message: string }

export function classifyChatImageFile(file: File, currentCount: number): ChatImageClassification {
  const mimeType = imageSourceMimeType(file.type)
  if (!mimeType) {
    return {
      status: 'reject',
      reason: 'unsupported-type',
      message: 'Choose a PNG, JPEG, WebP, GIF, HEIC, HEIF, AVIF, BMP or TIFF image.',
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
