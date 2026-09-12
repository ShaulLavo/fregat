import type { ProviderUserInputAnswers } from '@workspace/contracts'
import * as v from 'valibot'
import { createInternalError } from '../../../observability/structured-errors'

const answerSchema = v.union([
  v.string(),
  v.array(v.string()),
  v.object({ answers: v.array(v.string()) }),
])

export function codexUserInputAnswers(input: ProviderUserInputAnswers) {
  const answers: Record<string, { answers: string[] }> = {}
  for (const [id, answer] of Object.entries(input)) {
    const parsed = v.safeParse(answerSchema, answer)
    if (!parsed.success)
      throw createInternalError(`Invalid Codex user-input answer for question ${id}.`)
    answers[id] = { answers: answerValues(parsed.output) }
  }
  return answers
}

function answerValues(answer: v.InferOutput<typeof answerSchema>) {
  if (typeof answer === 'string') return [answer]
  if (Array.isArray(answer)) return answer
  return answer.answers
}
