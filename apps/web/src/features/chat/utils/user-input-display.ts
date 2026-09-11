import type { UserInputAnswerKind, UserInputQuestion } from '@workspace/contracts'
import {
  resolveUserInputAnswer,
  type UserInputAnswerDraft,
} from '@workspace/client-core/chat/pending-user-input'

/** Which option chips read as chosen. A typed "other" answer wins, so none do. */
export function selectedValues(
  question: UserInputQuestion,
  draft: UserInputAnswerDraft | undefined,
): readonly string[] {
  const answer = resolveUserInputAnswer(question, draft)
  if (answer === null) return []
  if (Array.isArray(answer)) return answer

  return [answer]
}

export function selectHint(answerKind: UserInputAnswerKind) {
  if (answerKind === 'multi-select') return 'Select one or more options.'

  return 'Select one option.'
}
