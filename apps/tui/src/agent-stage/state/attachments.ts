import {
  MAX_CHAT_ATTACHMENT_ENCODED_BYTES,
  CHAT_ATTACHMENT_SIZE_LABEL,
} from '@workspace/client-core/chat/attachments'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_CHAT_ATTACHMENTS, type ChatAttachmentUpload } from '@workspace/contracts'
import { createTuiError } from '@/host/utils/structured-errors'

export async function readAttachment(filename: string, current: readonly ChatAttachmentUpload[]) {
  if (current.length >= MAX_CHAT_ATTACHMENTS)
    throw createTuiError(
      `A prompt supports ${MAX_CHAT_ATTACHMENTS} images.`,
      'Remove an attachment before adding another.',
    )
  const resolved = path.resolve(filename.trim())
  const metadata = await stat(resolved)
  if (!metadata.isFile() || metadata.size > MAX_CHAT_ATTACHMENT_ENCODED_BYTES)
    throw createTuiError(
      `The image must be a file of at most ${CHAT_ATTACHMENT_SIZE_LABEL}.`,
      'Choose a supported image within the attachment limit.',
    )
  const bytes = await readFile(resolved)
  return attachmentFromBytes(bytes, path.basename(resolved), current)
}

export function attachmentFromBytes(
  bytes: Uint8Array,
  name: string,
  current: readonly ChatAttachmentUpload[],
) {
  if (current.length >= MAX_CHAT_ATTACHMENTS)
    throw createTuiError(
      `A prompt supports ${MAX_CHAT_ATTACHMENTS} images.`,
      'Remove an attachment before adding another.',
    )
  if (bytes.byteLength > MAX_CHAT_ATTACHMENT_ENCODED_BYTES)
    throw createTuiError(
      `The image must contain at most ${CHAT_ATTACHMENT_SIZE_LABEL}.`,
      'Choose a supported image within the attachment limit.',
    )
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const mimeType = imageMime(buffer)
  if (!mimeType)
    throw createTuiError(
      'This file is not a supported image.',
      'Choose a PNG, JPEG, GIF, or WebP image.',
    )
  return {
    type: 'image',
    id: crypto.randomUUID(),
    name,
    mimeType,
    sizeBytes: bytes.length,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  } satisfies ChatAttachmentUpload
}

export function appendAttachment(
  current: readonly ChatAttachmentUpload[],
  attachment: ChatAttachmentUpload,
) {
  if (current.length >= MAX_CHAT_ATTACHMENTS)
    throw createTuiError(
      `A prompt supports ${MAX_CHAT_ATTACHMENTS} images.`,
      'Remove an attachment before adding another.',
    )
  return [...current, attachment]
}

function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return null
}
