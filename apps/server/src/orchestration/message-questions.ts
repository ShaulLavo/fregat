import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  eventIdSchema,
  userInputQuestionSchema,
  type OrchestrationCommand,
  type OrchestrationSessionActivity,
  type ProviderUserInputAnswers,
  type UserInputAttachments,
  type SessionId,
} from '@workspace/contracts'
import { event } from './event-factory'
import { activityRequestId } from './pending-requests'
import { createInternalError } from '../observability/structured-errors'

const payloadSchema = v.object({
  requestId: approvalRequestIdSchema,
  responseMode: v.literal('message'),
  questions: v.optional(v.array(userInputQuestionSchema), []),
})
export type MessageQuestion = OrchestrationSessionActivity & {
  payload: v.InferOutput<typeof payloadSchema>
}

export function pendingMessageQuestions(activities: readonly OrchestrationSessionActivity[]) {
  const pending = new Map<string, MessageQuestion>()
  for (const activity of activities) {
    const requestId = activityRequestId(activity.payload)
    if (!requestId) continue
    if (activity.kind === 'user-input.resolved') {
      pending.delete(requestId)
      continue
    }
    if (activity.kind !== 'user-input.requested') continue
    const parsed = v.safeParse(payloadSchema, activity.payload)
    if (parsed.success) pending.set(requestId, { ...activity, payload: parsed.output })
  }
  return [...pending.values()]
}

export function retainMessageQuestions(
  activities: readonly OrchestrationSessionActivity[],
  limit: number,
) {
  const recent = activities.slice(-limit)
  const retained = new Set(recent.map((activity) => activity.id))
  const olderPending = pendingMessageQuestions(activities).filter(
    (activity) => !retained.has(activity.id),
  )
  return [...olderPending, ...recent]
}

export function messageQuestionAnswer(
  request: MessageQuestion,
  answers: ProviderUserInputAnswers,
  attachments?: UserInputAttachments,
) {
  if (request.payload.questions.length === 0)
    throw createInternalError('This question has no answer fields. Dismiss it instead.')
  return request.payload.questions
    .map((question) => {
      const answer = answers[question.id]
      if (
        typeof answer !== 'string' ||
        (answer.trim().length === 0 &&
          !(
            attachments?.[question.id]?.length &&
            (question.allowOther || question.answerKind === 'text')
          ))
      ) {
        throw createInternalError('Answer each question before sending.')
      }
      return `${question.prompt}\n${answer.trim()}`
    })
    .join('\n\n')
}

export function messageQuestionResolutionEvent(
  command: OrchestrationCommand,
  sessionId: SessionId,
  request: MessageQuestion,
  at: string,
  answers?: ProviderUserInputAnswers,
  attachmentsByQuestionId?: UserInputAttachments,
) {
  const action = answers ? 'answer' : 'dismiss'
  return event(command, at, 'session.activity-appended', {
    sessionId,
    activity: {
      sessionId,
      id: v.parse(eventIdSchema, `async-${action}:${request.payload.requestId}`),
      kind: 'user-input.resolved',
      summary: answers ? 'User input submitted' : 'User input dismissed',
      tone: 'info',
      turnId: request.turnId,
      createdAt: at,
      payload: {
        requestId: request.payload.requestId,
        responseMode: 'message',
        ...(answers ? { answers } : {}),
        ...(attachmentsByQuestionId ? { attachmentsByQuestionId } : {}),
      },
    },
  })
}

export function messageQuestionDismissalEvents(
  command: OrchestrationCommand,
  sessionId: SessionId,
  requests: readonly MessageQuestion[],
  at: string,
) {
  return requests.map((request) => messageQuestionResolutionEvent(command, sessionId, request, at))
}
