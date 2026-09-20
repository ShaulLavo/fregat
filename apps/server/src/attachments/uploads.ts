import type { AttachmentOwnership } from './ownership'
import { withAttachmentLane } from './lanes'
import { renameSync } from 'node:fs'
import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import {
  chatAttachmentSchema,
  chatAttachmentExtension,
  type AttachmentUploadInput,
  type AttachmentUploadTicket,
  type ChatAttachment,
} from '@workspace/contracts'
import { createInternalError } from '../observability/structured-errors'
import { attachmentFilePath } from './store'

const PENDING_MAX_AGE_MS = 24 * 60 * 60_000
const PARTIAL_MAX_AGE_MS = 60 * 60_000
const manifestSchema = v.object({ attachment: chatAttachmentSchema, createdAt: v.number() })
const uploadIdPattern = /^upload-[a-f0-9-]{36}$/

function requireUploadId(id: string) {
  if (!uploadIdPattern.test(id)) throw createInternalError('Invalid attachment upload reference.')
  return id
}

export async function createAttachmentUpload(
  attachmentsDir: string,
  input: AttachmentUploadInput,
  ownership: AttachmentOwnership,
): Promise<AttachmentUploadTicket> {
  if (input.type === 'image' && !chatAttachmentExtension(input.mimeType))
    throw createInternalError('This image format is not supported.')
  await mkdir(attachmentsDir, { recursive: true })
  await sweepAttachmentUploads(attachmentsDir, ownership)
  const attachment = { ...input, id: `upload-${crypto.randomUUID()}` }
  const createdAt = Date.now()
  await writeFile(
    join(attachmentsDir, `${attachment.id}.json`),
    JSON.stringify({ attachment, createdAt }),
    { flag: 'wx' },
  )
  return {
    attachment,
    expiresAt: new Date(createdAt + PENDING_MAX_AGE_MS).toISOString(),
    uploadPath: `/attachments/uploads/${attachment.id}`,
  }
}

async function readUpload(
  attachmentsDir: string,
  id: string,
  ownership: AttachmentOwnership,
  allowExpired = false,
) {
  requireUploadId(id)
  const text = await readFile(join(attachmentsDir, `${id}.json`), 'utf8').catch(() => null)
  if (!text) throw createInternalError('This upload expired or was removed. Retry the attachment.')
  const manifest = v.parse(manifestSchema, JSON.parse(text))
  if (!allowExpired && !ownership.owner(id) && Date.now() - manifest.createdAt > PENDING_MAX_AGE_MS)
    throw createInternalError('This upload expired. Retry the attachment.')
  return manifest
}

async function storeAttachmentUploadUnlocked(
  attachmentsDir: string,
  id: string,
  body: ReadableStream<Uint8Array> | null,
  ownership: AttachmentOwnership,
) {
  const { attachment } = await readUpload(attachmentsDir, id, ownership)
  if (!body) throw createInternalError('The attachment upload has no bytes.')
  if (ownership.owner(id)) throw createInternalError('This attachment was already sent.')
  const filePath = attachmentFilePath({ attachmentsDir, attachment })
  if (!filePath) throw createInternalError('The attachment path is invalid.')
  const partPath = `${filePath}.${crypto.randomUUID()}.part`
  const writer = await open(partPath, 'wx')
  const reader = body.getReader()
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > attachment.sizeBytes)
        throw createInternalError('The upload exceeds its declared size.')
      await writer.writeFile(chunk.value)
    }
    if (received !== attachment.sizeBytes)
      throw createInternalError('The upload ended before all bytes arrived.')
    await writer.close()
    if (ownership.owner(id)) throw createInternalError('This attachment was already sent.')
    renameSync(partPath, filePath)
    return attachment
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
    await writer.close().catch(() => undefined)
    await unlink(partPath).catch(() => undefined)
  }
}

export async function validateAttachmentUpload(
  attachmentsDir: string,
  attachment: ChatAttachment,
  sessionId: string,
  ownership: AttachmentOwnership,
): Promise<ChatAttachment> {
  const { attachment: stored } = await readUpload(attachmentsDir, attachment.id, ownership)
  if (
    stored.type !== attachment.type ||
    stored.name !== attachment.name ||
    stored.mimeType !== attachment.mimeType ||
    stored.sizeBytes !== attachment.sizeBytes
  )
    throw createInternalError('The attachment metadata does not match its upload.')
  const filePath = attachmentFilePath({ attachmentsDir, attachment: stored })
  if (!filePath || (await stat(filePath).catch(() => null))?.size !== stored.sizeBytes)
    throw createInternalError('The attachment is not fully uploaded. Retry before sending.')
  const owner = ownership.owner(stored.id)
  if (owner && owner !== sessionId)
    throw createInternalError('This attachment belongs to another session.')
  return stored
}

async function deletePendingAttachmentUploadUnlocked(
  attachmentsDir: string,
  id: string,
  ownership: AttachmentOwnership,
) {
  requireUploadId(id)
  if (ownership.owner(id)) return
  const { attachment } = await readUpload(attachmentsDir, id, ownership, true)
  const filePath = attachmentFilePath({ attachmentsDir, attachment })
  if (filePath) await unlink(filePath).catch(() => undefined)
  await unlink(join(attachmentsDir, `${id}.json`)).catch(() => undefined)
}

export async function uploadedAttachmentMetadata(
  attachmentsDir: string,
  id: string,
  ownership: AttachmentOwnership,
) {
  const { attachment } = await readUpload(attachmentsDir, id, ownership)
  const filePath = attachmentFilePath({ attachmentsDir, attachment })
  const bytes = filePath ? await stat(filePath).catch(() => null) : null
  return { attachment, ready: bytes?.size === attachment.sizeBytes }
}

async function sweepAttachmentUploads(attachmentsDir: string, ownership: AttachmentOwnership) {
  const files = await readdir(attachmentsDir)
  for (const name of files) {
    if (!name.startsWith('upload-')) continue
    const partial = name.endsWith('.part')
    if (!partial && !name.endsWith('.json')) continue
    const filePath = join(attachmentsDir, name)
    const info = await stat(filePath).catch(() => null)
    const maxAge = partial ? PARTIAL_MAX_AGE_MS : PENDING_MAX_AGE_MS
    if (!info || Date.now() - info.mtimeMs <= maxAge) continue
    if (partial) {
      await unlink(filePath).catch(() => undefined)
      continue
    }
    const id = name.slice(0, -5)
    await deletePendingAttachmentUpload(attachmentsDir, id, ownership).catch(() => undefined)
  }
}

export function storeAttachmentUpload(
  attachmentsDir: string,
  id: string,
  body: ReadableStream<Uint8Array> | null,
  ownership: AttachmentOwnership,
) {
  return withAttachmentLane(attachmentsDir, id, () =>
    storeAttachmentUploadUnlocked(attachmentsDir, id, body, ownership),
  )
}
export function deletePendingAttachmentUpload(
  attachmentsDir: string,
  id: string,
  ownership: AttachmentOwnership,
) {
  return withAttachmentLane(attachmentsDir, id, () =>
    deletePendingAttachmentUploadUnlocked(attachmentsDir, id, ownership),
  )
}

export async function collectSessionUploadAttachments(
  _attachmentsDir: string,
  sessionId: string,
  ownership: AttachmentOwnership,
): Promise<ChatAttachment[]> {
  return ownership.attachmentsForSession(sessionId)
}
