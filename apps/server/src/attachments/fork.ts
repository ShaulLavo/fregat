import { createHash } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import type { ChatAttachment, OrchestrationMessage } from '@workspace/contracts'
import { withAttachmentLanes } from './lanes'
import type { AttachmentOwnership } from './ownership'
import { attachmentFilePath, deleteAttachmentBlobs } from './store'
import { createInternalError, createStructuredError } from '../observability/structured-errors'

export async function copyForkAttachments(
  attachmentsDir: string,
  commandId: string,
  messages: readonly OrchestrationMessage[],
) {
  const copies: Record<string, ChatAttachment> = {}
  try {
    for (const attachment of messages.flatMap((message) => message.attachments)) {
      if (copies[attachment.id]) continue
      const digest = createHash('sha256').update(`${commandId}\0${attachment.id}`).digest('hex')
      const copy = { ...attachment, id: `fork-${digest}` }
      copies[attachment.id] = copy
      await copyBlob(attachmentsDir, attachment, copy)
    }
    return copies
  } catch (error) {
    await deleteAttachmentBlobs({ attachmentsDir, attachments: Object.values(copies) })
    throw error
  }
}

async function copyBlob(attachmentsDir: string, source: ChatAttachment, copy: ChatAttachment) {
  const sourcePath = attachmentFilePath({ attachmentsDir, attachment: source })
  const destination = attachmentFilePath({ attachmentsDir, attachment: copy })
  if (!sourcePath || !destination)
    throw createInternalError(`Attachment ${source.name} is unavailable.`)
  await withAttachmentLanes(attachmentsDir, [source.id, copy.id], () =>
    copyFile(sourcePath, destination).catch((error: unknown) => {
      throw createStructuredError({
        cause: error,
        code: 'attachments.FORK_SOURCE_MISSING',
        status: 409,
        message: `Attachment ${source.name} could not be copied into the fork.`,
        why: 'Its file is missing or unreadable in the attachment store.',
        fix: 'Fork from a turn before this attachment, or send it again in a new session.',
        internal: { attachmentId: source.id },
      })
    }),
  )
}

export async function discardUnclaimedForkAttachments(
  attachmentsDir: string,
  copies: Record<string, ChatAttachment>,
  ownership: AttachmentOwnership,
) {
  await deleteAttachmentBlobs({
    attachmentsDir,
    attachments: Object.values(copies).filter((attachment) => !ownership.owner(attachment.id)),
    ownership,
  })
}
