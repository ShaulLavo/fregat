import * as v from 'valibot'
import type { UserInputQuestion } from '@workspace/contracts'

const asyncMessageSchema = v.object({
  type: v.literal('agentMessage'),
  delivery: v.literal('async'),
  id: v.pipe(v.string(), v.nonEmpty()),
  questions: v.pipe(
    v.array(
      v.object({
        title: v.pipe(v.string(), v.trim(), v.nonEmpty()),
        options: v.nullish(v.array(v.string())),
      }),
    ),
    v.minLength(1),
  ),
})

export function codexAsyncQuestions(item: unknown) {
  const parsed = v.safeParse(asyncMessageSchema, item)
  if (!parsed.success) return null
  const questions: UserInputQuestion[] = parsed.output.questions.map((question, index) => ({
    id: String(index),
    header: 'Question',
    prompt: question.title,
    answerKind: question.options?.length ? 'single-select' : 'text',
    options: (question.options ?? []).map((label) => ({ value: label, label })),
    allowOther: true,
    secret: false,
  }))
  return { itemId: parsed.output.id, questions }
}
