import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { chatAttachmentSchema, type ChatAttachment } from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import { attachmentUploadOwners } from '../db/schema'
import { createInternalError } from '../observability/structured-errors'

export type AttachmentOwnership = {
  owner: (id: string) => string | null
  claim: (attachment: ChatAttachment, sessionId: string) => void
  release: (id: string) => void
  idsForSession: (sessionId: string) => string[]
  attachmentsForSession: (sessionId: string) => ChatAttachment[]
}

export function createAttachmentOwnership(database: PlatformDatabase): AttachmentOwnership {
  const owner = (id: string) =>
    database
      .select({ sessionId: attachmentUploadOwners.sessionId })
      .from(attachmentUploadOwners)
      .where(eq(attachmentUploadOwners.attachmentId, id))
      .get()?.sessionId ?? null
  return {
    owner,
    claim(attachment, sessionId) {
      const previous = owner(attachment.id)
      if (previous && previous !== sessionId)
        throw createInternalError('This attachment belongs to another session.')
      if (previous) return
      database
        .insert(attachmentUploadOwners)
        .values({
          attachmentId: attachment.id,
          sessionId,
          attachmentJson: JSON.stringify(attachment),
        })
        .run()
    },
    release(id) {
      database
        .delete(attachmentUploadOwners)
        .where(eq(attachmentUploadOwners.attachmentId, id))
        .run()
    },
    idsForSession(sessionId) {
      return database
        .select({ id: attachmentUploadOwners.attachmentId })
        .from(attachmentUploadOwners)
        .where(eq(attachmentUploadOwners.sessionId, sessionId))
        .all()
        .map((row) => row.id)
    },
    attachmentsForSession(sessionId) {
      return database
        .select({ metadata: attachmentUploadOwners.attachmentJson })
        .from(attachmentUploadOwners)
        .where(eq(attachmentUploadOwners.sessionId, sessionId))
        .all()
        .map((row) => v.parse(chatAttachmentSchema, JSON.parse(row.metadata)))
    },
  }
}
