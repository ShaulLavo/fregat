/**
 * What the composer will accept as an image attachment.
 *
 * The binding constraint is downstream and narrower than our own contract:
 * `chatAttachmentSchema.mimeType` allows any `image/*`, but the Claude SDK
 * accepts exactly gif/jpeg/png/webp and hard-fails the whole turn on anything
 * else. A macOS HEIC paste therefore has to be refused here, in the browser,
 * rather than surfacing as a mid-turn server error with no way back.
 */

import { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_ATTACHMENTS } from '@workspace/contracts'

const BYTES_PER_MEGABYTE = 1024 * 1024

/** Exactly the media types the Claude SDK accepts. Do not widen. */
const CHAT_IMAGE_MIME_ALLOWLIST = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const

export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_ALLOWLIST)[number]

/**
 * Ceiling on the *source* file handed to the re-encoder. File size is a proxy
 * for pixel count, and decoding hundreds of megapixels into an `ImageBitmap`
 * can OOM the tab — beyond this we refuse rather than risk it.
 */
export const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * BYTES_PER_MEGABYTE

/**
 * The binary budget an encode has to hit so the thing actually sent fits
 * `MAX_CHAT_ATTACHMENT_BYTES`.
 *
 * What travels is a base64 data URL, not the bytes: base64 spends 4 characters
 * per 3 bytes, so an image compressed to exactly the cap ships roughly a third
 * more than the cap allows — and passes validation, because `sizeBytes` reports
 * the pre-encoding size. Budgeting backwards from the wire is what makes the
 * limit describe the payload it is named after.
 */
export const MAX_CHAT_ATTACHMENT_ENCODED_BYTES = Math.floor(
  ((MAX_CHAT_ATTACHMENT_BYTES - longestChatImageDataUrlPrefix()) * 3) / 4,
)

/** Length of the data URL a blob of `byteLength` bytes serializes to, prefix included. */
export function chatAttachmentDataUrlLength(byteLength: number, mimeType: string) {
  return chatImageDataUrlPrefix(mimeType).length + 4 * Math.ceil(byteLength / 3)
}

function chatImageDataUrlPrefix(mimeType: string) {
  return `data:${mimeType};base64,`
}

/**
 * The budget is one number for every type, so it has to hold for the longest
 * header any allowlisted image can produce — a couple of spare bytes beats a
 * per-type budget nothing else would ever read.
 */
function longestChatImageDataUrlPrefix() {
  return Math.max(...CHAT_IMAGE_MIME_ALLOWLIST.map((type) => chatImageDataUrlPrefix(type).length))
}

type ChatImageRejectionReason = 'empty' | 'too-large' | 'too-many' | 'unsupported-type'

export type ChatImageClassification =
  | {
      status: 'accept'
      /** Normalized media type — use this, not `file.type`, downstream. */
      mimeType: ChatImageMimeType
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
  const mimeType = allowedChatImageMimeType(file.type)
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

/**
 * `image/jpg` is not a registered media type, but plenty of tools write it.
 * Normalizing costs two lines and saves a turn that would otherwise die at the
 * provider on a file the user reasonably believes is a JPEG.
 */
function allowedChatImageMimeType(rawMimeType: string): ChatImageMimeType | null {
  const mimeType = rawMimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mimeType === 'image/jpg') return 'image/jpeg'

  return CHAT_IMAGE_MIME_ALLOWLIST.find((allowed) => allowed === mimeType) ?? null
}
