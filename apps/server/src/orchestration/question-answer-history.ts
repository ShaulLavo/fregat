import * as v from 'valibot'
import {
  eventIdSchema,
  userInputQuestionSchema,
  type OrchestrationCommand,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import { activityRequestId } from './pending-requests'
import { event } from './event-factory'

const questionsSchema = v.object({ questions: v.array(userInputQuestionSchema) })

export function questionAnswerHistory(
  command: Extract<OrchestrationCommand, { type: 'session.user-input.respond' }>,
  activities: readonly OrchestrationSessionActivity[],
  at: string,
) {
  const attachments = Object.values(command.attachmentsByQuestionId ?? {}).flat()
  if (attachments.length === 0) return []
  const request = activities.findLast(
    (activity) =>
      activity.kind === 'user-input.requested' &&
      activityRequestId(activity.payload) === command.requestId,
  )
  const parsed = v.safeParse(questionsSchema, request?.payload)
  const questionTextById = Object.fromEntries(
    (parsed.success ? parsed.output.questions : []).map((question) => [
      question.id,
      question.prompt,
    ]),
  )
  return [
    event(command, at, 'session.activity-appended', {
      sessionId: command.sessionId,
      activity: {
        id: v.parse(eventIdSchema, `question-answer:${command.commandId}`),
        sessionId: command.sessionId,
        kind: 'user-input.answer-submitted',
        summary: 'Question answer submitted',
        tone: 'info',
        turnId: request?.turnId ?? null,
        createdAt: at,
        payload: {
          requestId: command.requestId,
          answers: command.answers,
          questionTextById,
          attachmentsByQuestionId: command.attachmentsByQuestionId,
          detail: attachments.map((attachment) => attachment.name).join('\n'),
        },
      },
    }),
  ]
}
