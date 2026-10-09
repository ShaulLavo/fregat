import { copyFile, rename, stat, unlink } from 'node:fs/promises'
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
  const source = await files.blob(path)
  if (source.size <= 0) throw attachmentErrors.MACHINE_FILE_EMPTY({ internal: { sizeBytes: 0 } })
  if (source.size > MAX_CHAT_FILE_ATTACHMENT_BYTES)
    throw attachmentErrors.MACHINE_FILE_TOO_LARGE({
      internal: { sizeBytes: source.size, limitBytes: MAX_CHAT_FILE_ATTACHMENT_BYTES },
    })
  const ticket = await createAttachmentUpload(
    attachmentsDir,
    uploadInput(source.absolutePath, source.size),
    ownership,
  )
  const id = ticket.attachment.id
  try {
    await withAttachmentLane(attachmentsDir, id, () =>
      copyInto(attachmentsDir, ticket.attachment, source.absolutePath),
    )
  } catch (error) {
    await deletePendingAttachmentUpload(attachmentsDir, id, ownership).catch(() => undefined)
    throw error
  }
  return { attachment: ticket.attachment, expiresAt: ticket.expiresAt }
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
  sourcePath: string,
) {
  const target = attachmentFilePath({ attachmentsDir, attachment })
  if (!target) throw attachmentErrors.MACHINE_FILE_CHANGED({ internal: { reason: 'no-target' } })
  const partPath = `${target}.${crypto.randomUUID()}.part`
  try {
    await copyFile(sourcePath, partPath)
    const copied = await stat(partPath)
    if (copied.size !== attachment.sizeBytes)
      throw attachmentErrors.MACHINE_FILE_CHANGED({
        internal: { expectedBytes: attachment.sizeBytes, copiedBytes: copied.size },
      })
    await rename(partPath, target)
  } finally {
    await unlink(partPath).catch(() => undefined)
  }
}
