import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { chatAttachmentsSchema, userInputAttachmentsSchema } from '@workspace/contracts'
import type { OrchestrationDatabase } from './event-store'
import { projectionSessionActivities, projectionSessionMessages } from '../db/schema'

const answerSchema = v.object({ attachmentsByQuestionId: userInputAttachmentsSchema })

export function sessionAttachments(database: OrchestrationDatabase, sessionId: string) {
  const messages = database
    .select({ attachments: projectionSessionMessages.attachmentsJson })
    .from(projectionSessionMessages)
    .where(eq(projectionSessionMessages.sessionId, sessionId))
    .all()
  const answers = database
    .select({ payload: projectionSessionActivities.payloadJson })
    .from(projectionSessionActivities)
    .where(
      and(
        eq(projectionSessionActivities.sessionId, sessionId),
        eq(projectionSessionActivities.kind, 'user-input.answer-submitted'),
      ),
    )
    .all()
  const attachments = messages.flatMap((row) =>
    v.parse(chatAttachmentsSchema, JSON.parse(row.attachments)),
  )
  for (const answer of answers) {
    const { attachmentsByQuestionId } = v.parse(answerSchema, JSON.parse(answer.payload))
    attachments.push(...Object.values(attachmentsByQuestionId).flat())
  }
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()]
}
