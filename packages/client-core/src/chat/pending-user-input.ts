import {
  approvalRequestIdSchema,
  userInputQuestionSchema,
  type ApprovalRequestId,
  type OrchestrationSessionActivity,
  type TurnId,
  type UserInputQuestion,
} from '@workspace/contracts'
import * as v from 'valibot'

import { orderedSessionActivities } from './pending-approvals'

export type PendingUserInput = {
  readonly createdAt: string
  readonly questions: readonly UserInputQuestion[]
  readonly requestId: ApprovalRequestId
  readonly turnId: TurnId | null
}

/**
 * One question's in-progress answer. `selectedValues` holds option `value`s —
 * what goes back to the provider — never the display labels.
 */
export type UserInputAnswerDraft = {
  readonly customAnswer?: string
  readonly selectedValues?: readonly string[]
}

/** Drafts keyed by question id, exactly how the respond command keys answers. */
export type UserInputAnswerDrafts = Readonly<Record<string, UserInputAnswerDraft>>

export type UserInputAnswers = Record<string, string | string[]>

const userInputPayloadSchema = v.object({
  questions: v.optional(v.array(v.unknown())),
  requestId: approvalRequestIdSchema,
})

/**
 * Requested minus resolved, oldest first — the user-input twin of
 * `derivePendingApprovals`, derived client-side for the same reason.
 */
export function derivePendingUserInputs(
  activities: readonly OrchestrationSessionActivity[],
): PendingUserInput[] {
  const open = new Map<ApprovalRequestId, PendingUserInput>()

  for (const activity of orderedSessionActivities(activities)) {
    if (!isUserInputActivity(activity.kind)) continue

    const parsed = v.safeParse(userInputPayloadSchema, activity.payload)
    if (!parsed.success) continue

    if (activity.kind === 'user-input.resolved') {
      open.delete(parsed.output.requestId)
      continue
    }

    openPendingUserInput(open, activity, parsed.output.requestId, parsed.output.questions)
  }

  return [...open.values()]
}

/**
 * What the draft currently amounts to, or null while the question is
 * unanswered. Typed text only counts for a select when the question allows an
 * "other" answer; on a multi-select it rides along as one more value.
 */
export function resolveUserInputAnswer(
  question: UserInputQuestion,
  draft: UserInputAnswerDraft | undefined,
): string | string[] | null {
  if (question.answerKind === 'text') return normalizeCustomAnswer(draft?.customAnswer)

  const customAnswer = otherAnswer(question, draft)
  const selected = normalizeSelectedValues(draft?.selectedValues)
  if (question.answerKind === 'single-select') return customAnswer ?? selected[0] ?? null

  const values = customAnswer ? [...selected, customAnswer] : selected

  return values.length > 0 ? values : null
}

/**
 * Adds or removes a value on a multi-select, replaces the pick on anything
 * else. A single-select also drops the typed "other" text, which would
 * otherwise keep winning over the option the user just clicked.
 */
export function toggleUserInputOption(
  question: UserInputQuestion,
  draft: UserInputAnswerDraft | undefined,
  optionValue: string,
): UserInputAnswerDraft {
  if (question.answerKind !== 'multi-select')
    return { customAnswer: '', selectedValues: [optionValue] }

  const selected = normalizeSelectedValues(draft?.selectedValues)
  const next = selected.includes(optionValue)
    ? selected.filter((value) => value !== optionValue)
    : [...selected, optionValue]

  return { customAnswer: draft?.customAnswer ?? '', selectedValues: next }
}

export function setUserInputCustomAnswer(
  draft: UserInputAnswerDraft | undefined,
  customAnswer: string,
): UserInputAnswerDraft {
  return { customAnswer, selectedValues: normalizeSelectedValues(draft?.selectedValues) }
}

/** Where the panel should sit. Falls back to the last question once all are answered. */
export function firstUnansweredUserInputIndex(
  questions: readonly UserInputQuestion[],
  drafts: UserInputAnswerDrafts,
): number {
  const index = questions.findIndex(
    (question) => !resolveUserInputAnswer(question, drafts[question.id]),
  )
  if (index !== -1) return index

  return Math.max(questions.length - 1, 0)
}

export function isUserInputDraftComplete(
  questions: readonly UserInputQuestion[],
  drafts: UserInputAnswerDrafts,
): boolean {
  return buildUserInputAnswers(questions, drafts) !== null
}

/**
 * The `answers` record for `session.user-input.respond`, or null while any
 * question is unanswered — a partial record would let the provider answer the
 * rest on the user's behalf.
 */
export function buildUserInputAnswers(
  questions: readonly UserInputQuestion[],
  drafts: UserInputAnswerDrafts,
): UserInputAnswers | null {
  const answers: UserInputAnswers = {}

  for (const question of questions) {
    const answer = resolveUserInputAnswer(question, drafts[question.id])
    if (!answer) return null

    answers[question.id] = answer
  }

  return answers
}

function openPendingUserInput(
  open: Map<ApprovalRequestId, PendingUserInput>,
  activity: OrchestrationSessionActivity,
  requestId: ApprovalRequestId,
  rawQuestions: readonly unknown[] | undefined,
) {
  const questions = parseUserInputQuestions(rawQuestions)
  if (questions.length === 0) return

  open.set(requestId, {
    createdAt: activity.createdAt,
    questions,
    requestId,
    turnId: activity.turnId,
  })
}

/**
 * Parsed one question at a time rather than as a batch: a shape we have not
 * met costs that question, not the whole prompt.
 */
function parseUserInputQuestions(rawQuestions: readonly unknown[] | undefined) {
  const questions: UserInputQuestion[] = []

  for (const raw of rawQuestions ?? []) {
    const parsed = v.safeParse(userInputQuestionSchema, raw)
    if (!parsed.success) continue

    questions.push(parsed.output)
  }

  return questions
}

function isUserInputActivity(kind: string) {
  return kind === 'user-input.requested' || kind === 'user-input.resolved'
}

function otherAnswer(question: UserInputQuestion, draft: UserInputAnswerDraft | undefined) {
  if (!question.allowOther) return null

  return normalizeCustomAnswer(draft?.customAnswer)
}

function normalizeCustomAnswer(value: string | undefined) {
  const text = value?.trim()

  return text ? text : null
}

function normalizeSelectedValues(value: readonly string[] | undefined): string[] {
  const values = new Set<string>()

  for (const entry of value ?? []) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    values.add(trimmed)
  }

  return [...values]
}
