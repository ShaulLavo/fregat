import { asc, eq, inArray, and } from 'drizzle-orm'
import * as v from 'valibot'
import { chatAttachmentSchema } from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import { projectionSessionMessages as messages } from '../db/schema'

export function sessionTitleMessages(database: PlatformDatabase, sessionId: string) {
  return database
    .select({ role: messages.role, text: messages.text, attachmentsJson: messages.attachmentsJson })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), inArray(messages.role, ['user', 'assistant'])))
    .orderBy(asc(messages.createdAt), asc(messages.messageId))
    .all()
    .map((row) => ({
      role: row.role,
      text: row.text,
      attachments: v.parse(v.array(chatAttachmentSchema), JSON.parse(row.attachmentsJson)),
    }))
}
