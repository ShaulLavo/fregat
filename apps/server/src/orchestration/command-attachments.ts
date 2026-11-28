import type { AttachmentOwnership } from '../attachments/ownership'
import { writeAttachmentFromDataUrl, attachmentFilePath } from '../attachments/store'
import { validateAttachmentUpload } from '../attachments/uploads'
import { createInternalError } from '../observability/structured-errors'
import type { CommandAttachmentIngest } from '../observability/chat-pipeline'

import * as v from 'valibot'
import {
  chatAttachmentSchema,
  type OrchestrationCommand,
  type ChatAttachment,
  type ChatAttachmentUpload,
} from '@workspace/contracts'

export function commandUploadClaim(command: OrchestrationCommand) {
  if (command.type === 'session.fork')
    return { sessionId: command.sessionId, attachments: Object.values(command.attachmentCopies) }
  if (command.type === 'session.turn.start' || command.type === 'session.turn.steer')
    return {
      sessionId: command.sessionId,
      attachments: command.message.attachments
        .filter((attachment) => attachment.id.startsWith('upload-'))
        .map((attachment) => v.parse(chatAttachmentSchema, attachment)),
    }
  if (command.type === 'session.user-input.respond')
    return {
      sessionId: command.sessionId,
      attachments: Object.values(command.attachmentsByQuestionId ?? {})
        .flat()
        .filter((attachment) => attachment.id.startsWith('upload-')),
    }
  return null
}

/**
 * Write-through between parse and dispatch. Attachment bytes hit the blob store
 * exactly once here; everything downstream sees metadata only.
 */
export async function ingestCommandAttachments(
  command: OrchestrationCommand,
  attachmentsDir: string,
  ownership: AttachmentOwnership,
): Promise<{ attachmentIngest?: CommandAttachmentIngest; command: OrchestrationCommand }> {
  if (command.type === 'session.user-input.respond' && command.attachmentsByQuestionId) {
    const kept: Record<string, ChatAttachment[]> = {}
    for (const [questionId, attachments] of Object.entries(command.attachmentsByQuestionId)) {
      kept[questionId] = (
        await persistTurnAttachments(attachments, attachmentsDir, command.sessionId, ownership)
      ).attachments
    }
    return { command: { ...command, attachmentsByQuestionId: kept } }
  }
  if (command.type !== 'session.turn.start' && command.type !== 'session.turn.steer')
    return { command }
  if (command.message.attachments.length === 0) return { command }

  const ingested = await persistTurnAttachments(
    command.message.attachments,
    attachmentsDir,
    command.sessionId,
    ownership,
  )

  return {
    attachmentIngest: ingested.attachmentIngest,
    command: {
      ...command,
      message: { ...command.message, attachments: ingested.attachments },
    },
  }
}

async function persistTurnAttachments(
  attachments: readonly ChatAttachmentUpload[],
  attachmentsDir: string,
  sessionId: string,
  ownership: AttachmentOwnership,
) {
  const kept: ChatAttachment[] = []
  const ids = new Set<string>()
  let bytesPersisted = 0
  for (const attachment of attachments) {
    if (ids.has(attachment.id))
      throw createInternalError('The same attachment cannot be sent twice.')
    ids.add(attachment.id)
    if (attachment.id.startsWith('upload-')) {
      kept.push(await validateAttachmentUpload(attachmentsDir, attachment, sessionId, ownership))
      continue
    }
    if (attachment.type === 'file') throw createInternalError('Upload this file before sending it.')
    if (attachment.dataUrl) {
      const written = await writeAttachmentFromDataUrl({ attachment, attachmentsDir })
      bytesPersisted += written.bytesWritten
      kept.push({ ...attachmentMetadata(attachment), sizeBytes: written.bytesWritten })
      continue
    }
    const filePath = attachmentFilePath({ attachment, attachmentsDir })
    if (!filePath || !(await Bun.file(filePath).exists()))
      throw createInternalError('Attachment is unavailable. Attach it again.')
    kept.push(attachmentMetadata(attachment))
  }
  return {
    attachmentIngest: { bytesPersisted, dropReasons: [], dropped: 0, persisted: kept.length },
    attachments: kept,
  }
}

function attachmentMetadata(attachment: ChatAttachmentUpload): ChatAttachment {
  return {
    type: attachment.type,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  }
}
