import { userInputAttachmentsSchema, type ChatAttachment } from '@workspace/contracts'
import * as v from 'valibot'

const historySchema = v.object({
  answers: v.record(v.string(), v.unknown()),
  questionTextById: v.optional(v.record(v.string(), v.string()), {}),
  attachmentsByQuestionId: v.optional(userInputAttachmentsSchema, {}),
})

export type QuestionAnswerRow = {
  readonly id: string
  readonly question: string
  readonly answer: string
  readonly attachments: readonly ChatAttachment[]
}

export function questionAnswerText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(questionAnswerText).filter(Boolean).join(', ')
  if (value && typeof value === 'object' && 'answers' in value)
    return questionAnswerText(value.answers)
  return ''
}

export function questionAnswerHistory(payload: unknown): readonly QuestionAnswerRow[] {
  const result = v.safeParse(historySchema, payload)
  if (!result.success) return []
  const { answers, questionTextById, attachmentsByQuestionId } = result.output
  const ids = new Set([
    ...Object.keys(questionTextById),
    ...Object.keys(answers),
    ...Object.keys(attachmentsByQuestionId),
  ])
  return [...ids].map((id) => ({
    id,
    question: questionTextById[id] ?? '',
    answer: questionAnswerText(answers[id]),
    attachments: attachmentsByQuestionId[id] ?? [],
  }))
}

export function questionAnswerHistoryEqual(
  left: readonly QuestionAnswerRow[] = [],
  right: readonly QuestionAnswerRow[] = [],
) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((row, index) => {
    const other = right[index]!
    return (
      row.id === other.id &&
      row.question === other.question &&
      row.answer === other.answer &&
      row.attachments.length === other.attachments.length &&
      row.attachments.every((attachment, slot) => {
        const compared = other.attachments[slot]!
        return (
          attachment.id === compared.id &&
          attachment.name === compared.name &&
          attachment.type === compared.type &&
          attachment.mimeType === compared.mimeType &&
          attachment.sizeBytes === compared.sizeBytes
        )
      })
    )
  })
}
