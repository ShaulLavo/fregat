import type { AttachmentOwnership } from './ownership'
import { withAttachmentLane } from './lanes'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  chatAttachmentExtension,
  MAX_CHAT_ATTACHMENT_BYTES,
  type ChatAttachment,
  type ChatAttachmentUpload,
} from '@workspace/contracts'

import { platformHomePath } from '../home'
import { createInternalError } from '../observability/structured-errors'
import {
  attachmentFileName,
  mimeTypeForAttachmentFileName,
  resolveAttachmentRelativePath,
} from './utils/paths'

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([\s\S]+)$/

export type AttachmentWriteResult = {
  readonly bytesWritten: number
  readonly filePath: string
}

export type AttachmentFile = {
  readonly byteLength: number
  readonly contentType: string
  readonly filePath: string
}

/**
 * Blobs live beside the SQLite metadata database (see `../db/client.ts`) so all
 * local platform state sits under one directory.
 */
export function defaultAttachmentsDir(): string {
  return platformHomePath('attachments')
}

export async function writeAttachmentFromDataUrl(input: {
  readonly attachmentsDir: string
  readonly attachment: ChatAttachmentUpload
}): Promise<AttachmentWriteResult> {
  const { attachment, attachmentsDir } = input

  if (attachment.type !== 'image' || !attachment.dataUrl) {
    throw createInternalError(`Attachment ${attachment.id} carries no dataUrl to persist.`)
  }
  if (!chatAttachmentExtension(attachment.mimeType)) {
    throw createInternalError(
      `Attachment ${attachment.id} has an unsupported image type: ${attachment.mimeType}.`,
    )
  }

  const payload = parseBase64DataUrl(attachment.dataUrl)
  if (!payload) {
    throw createInternalError(`Attachment ${attachment.id} has a malformed base64 data URL.`)
  }
  if (payload.mimeType !== attachment.mimeType.trim().toLowerCase()) {
    throw createInternalError(
      `Attachment ${attachment.id} data URL type ${payload.mimeType} disagrees with declared ${attachment.mimeType}.`,
    )
  }

  const filePath = attachmentFilePath({ attachmentsDir, attachment })
  if (!filePath) {
    throw createInternalError(`Attachment ${attachment.id} resolves outside the attachments root.`)
  }

  const bytes = Buffer.from(payload.base64, 'base64')
  // Measured, not declared. `sizeBytes` arrives from the client and the schema
  // caps it, but nothing makes the payload agree with it — so the decoded
  // length is re-checked here, and it is this number the caller persists.
  if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
    throw createInternalError(
      `Attachment ${attachment.id} decodes to ${bytes.byteLength} bytes, over the ${MAX_CHAT_ATTACHMENT_BYTES} limit.`,
    )
  }

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes)
  return { bytesWritten: bytes.byteLength, filePath }
}

/**
 * Null — never a throw — when the blob is unreadable. A pruned or hand-deleted
 * file has to degrade to "image dropped from the turn", not kill the turn.
 */
export async function readAttachmentBytes(input: {
  readonly attachmentsDir: string
  readonly attachment: ChatAttachment
}): Promise<Uint8Array | null> {
  const filePath = attachmentFilePath(input)
  if (!filePath) return null

  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

/**
 * Resolves a blob addressed the way a URL addresses it — by file name — to the
 * path and length a response needs. The bytes are deliberately not read: the
 * route streams the file, so a 10 MB screenshot never lands in the heap.
 *
 * Null, never a throw, for every miss. An extension outside the allowlist, a
 * name that is not a single segment inside the root, and a file that is simply
 * not there are all the same 404 to a browser.
 */
export async function resolveAttachmentFile(input: {
  readonly attachmentsDir: string
  readonly fileName: string
}): Promise<AttachmentFile | null> {
  const contentType = mimeTypeForAttachmentFileName(input.fileName)
  if (!contentType) return null

  const filePath = resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: input.fileName,
  })
  if (!filePath) return null
  // Blobs are written flat, so anything nested is a probe, not an attachment.
  if (path.dirname(filePath) !== path.resolve(input.attachmentsDir)) return null

  const stats = await stat(filePath).catch(() => null)
  if (!stats?.isFile()) return null

  return { byteLength: stats.size, contentType, filePath }
}

async function removeAttachmentFile(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}

// Missing blobs are already reclaimed; other failures remain retryable deletion work.
export async function deleteAttachmentBlobs(input: {
  readonly attachmentsDir: string
  readonly attachments: readonly ChatAttachment[]
  readonly ownership?: AttachmentOwnership
}): Promise<number> {
  let reclaimed = 0

  for (const attachment of input.attachments) {
    if (attachment.id.startsWith('upload-') && !input.ownership)
      throw createInternalError('Upload cleanup requires ownership storage.')
    const filePath = attachmentFilePath({ attachmentsDir: input.attachmentsDir, attachment })
    if (!filePath) continue
    reclaimed += await withAttachmentLane(input.attachmentsDir, attachment.id, async () => {
      const removed = await removeAttachmentFile(filePath)
      if (attachment.id.startsWith('upload-')) {
        await removeAttachmentFile(path.join(input.attachmentsDir, `${attachment.id}.json`))
      }
      input.ownership?.release(attachment.id)
      return removed ? 1 : 0
    })
  }

  return reclaimed
}

export function attachmentFilePath(input: {
  readonly attachmentsDir: string
  readonly attachment: ChatAttachment
}): string | null {
  const fileName = attachmentFileName(input.attachment)
  if (!fileName) return null

  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: fileName,
  })
}

function parseBase64DataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) return null

  const [, mimeType, base64] = match
  if (!mimeType || !base64) return null
  return { mimeType: mimeType.trim().toLowerCase(), base64 }
}
