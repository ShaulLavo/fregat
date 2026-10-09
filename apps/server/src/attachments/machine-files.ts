import { constants } from 'node:fs'
import { open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_FILE_ATTACHMENT_BYTES,
  normalizeChatAttachmentMimeType,
  type AttachmentUploadInput,
  type MachineFileAttachment,
} from '@workspace/contracts'

import { observeRequestOperation } from '../observability'
import { withAttachmentLane } from './lanes'
import type { AttachmentOwnership } from './ownership'
import { attachmentFilePath } from './store'
import { attachmentErrors } from './structured-errors'
import { createAttachmentUpload, deletePendingAttachmentUpload } from './uploads'

/** The filesystem reads this needs: a regular file inside the served root, by its client path. */
export type MachineFiles = {
  blob(path: string): Promise<{ absolutePath: string; size: number }>
}

const MAX_FILE_NAME_LENGTH = 255
const MAX_MIME_TYPE_LENGTH = 100
const COPY_CHUNK_BYTES = 64 * 1024

/**
 * Stages a file from this server's disk the way an upload is staged, copying it on disk so a
 * remote client never carries the bytes. The result is ready to send.
 */
export function attachMachineFile(input: {
  attachmentsDir: string
  files: MachineFiles
  ownership: AttachmentOwnership
  path: string
}): Promise<MachineFileAttachment> {
  return observeRequestOperation(
    { area: 'attachments', operation: 'attach_machine_file' },
    () => stageMachineFile(input),
    (result) => ({
      attachmentType: result.attachment.type,
      mimeType: result.attachment.mimeType,
      sizeBytes: result.attachment.sizeBytes,
    }),
  )
}

async function stageMachineFile({
  attachmentsDir,
  files,
  ownership,
  path,
}: {
  attachmentsDir: string
  files: MachineFiles
  ownership: AttachmentOwnership
  path: string
}): Promise<MachineFileAttachment> {
  const { absolutePath } = await files.blob(path)
  // One handle from check to copy: the path cannot be swapped between them, and a non-blocking
  // open keeps a FIFO put there from holding the request.
  const source = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const sizeBytes = await regularFileSize(source)
    const ticket = await createAttachmentUpload(
      attachmentsDir,
      uploadInput(absolutePath, sizeBytes),
      ownership,
    )
    const id = ticket.attachment.id
    try {
      await withAttachmentLane(attachmentsDir, id, () =>
        copyInto(attachmentsDir, ticket.attachment, source),
      )
    } catch (error) {
      await deletePendingAttachmentUpload(attachmentsDir, id, ownership).catch(() => undefined)
      throw error
    }
    return { attachment: ticket.attachment, expiresAt: ticket.expiresAt }
  } finally {
    await source.close()
  }
}

async function regularFileSize(source: FileHandle) {
  const stats = await source.stat()
  if (!stats.isFile())
    throw attachmentErrors.MACHINE_FILE_CHANGED({ internal: { reason: 'not-regular-file' } })
  if (stats.size <= 0) throw attachmentErrors.MACHINE_FILE_EMPTY({ internal: { sizeBytes: 0 } })
  if (stats.size > MAX_CHAT_FILE_ATTACHMENT_BYTES)
    throw attachmentErrors.MACHINE_FILE_TOO_LARGE({
      internal: { sizeBytes: stats.size, limitBytes: MAX_CHAT_FILE_ATTACHMENT_BYTES },
    })
  return stats.size
}

/** Images the provider takes inline go as images; anything else, or larger, goes as a file. */
function uploadInput(absolutePath: string, sizeBytes: number): AttachmentUploadInput {
  const name = basename(absolutePath).slice(0, MAX_FILE_NAME_LENGTH)
  const detected = Bun.file(absolutePath).type
  const image = normalizeChatAttachmentMimeType(detected)
  if (image && inlineImageFits(image, sizeBytes))
    return { type: 'image', name, mimeType: image, sizeBytes }

  return {
    type: 'file',
    name,
    mimeType: detected.slice(0, MAX_MIME_TYPE_LENGTH) || 'application/octet-stream',
    sizeBytes,
  }
}

// The provider receives an image as a data URL, and the whole URL must fit the image ceiling.
function inlineImageFits(mimeType: string, sizeBytes: number) {
  const encoded = `data:${mimeType};base64,`.length + 4 * Math.ceil(sizeBytes / 3)
  return encoded <= MAX_CHAT_ATTACHMENT_BYTES
}

async function copyInto(
  attachmentsDir: string,
  attachment: MachineFileAttachment['attachment'],
  source: FileHandle,
) {
  const target = attachmentFilePath({ attachmentsDir, attachment })
  if (!target) throw attachmentErrors.MACHINE_FILE_CHANGED({ internal: { reason: 'no-target' } })
  const partPath = `${target}.${crypto.randomUUID()}.part`
  const writer = await open(partPath, 'wx')
  try {
    await copyExactly(source, writer, attachment.sizeBytes)
    await writer.close()
    await rename(partPath, target)
  } finally {
    await writer.close().catch(() => undefined)
    await unlink(partPath).catch(() => undefined)
  }
}

/**
 * Copies the file the handle holds, reading at most one byte past `expectedBytes`, so a file
 * that grew after its size was checked is refused before more than that is read.
 */
export async function copyExactly(source: FileHandle, writer: FileHandle, expectedBytes: number) {
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES)
  let copied = 0
  for (;;) {
    const wanted = Math.min(buffer.byteLength, expectedBytes + 1 - copied)
    const { bytesRead } = await source.read(buffer, 0, wanted, copied)
    if (bytesRead === 0) break
    copied += bytesRead
    if (copied > expectedBytes) break
    await writer.write(buffer, 0, bytesRead)
  }
  if (copied !== expectedBytes)
    throw attachmentErrors.MACHINE_FILE_CHANGED({
      internal: { expectedBytes, copiedBytes: copied },
    })
}
