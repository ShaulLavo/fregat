import * as v from 'valibot'
import { providerInstanceIdSchema, providerSlugSchema, type ProviderInstanceId } from './chat-ids'

export const runtimeModeSchema = v.picklist([
  'full-access',
  'approval-required',
  'auto-accept-edits',
])
export const interactionModeSchema = v.picklist(['default', 'plan'])

export const providerDriverKindSchema = v.pipe(providerSlugSchema, v.brand('ProviderDriverKind'))

/**
 * Reasoning effort ids stay open strings: Codex speaks `low..ultra` and the
 * Claude SDK stops at `max`, so any closed enum shared across providers would
 * reject the other's levels.
 */
export const reasoningEffortSchema = v.pipe(v.string(), v.trim(), v.minLength(1))

/**
 * Still open — adapters read their own keys out of it — but the reasoning
 * effort is typed because it is the one option the picker, the persisted
 * per-session selection, and every adapter must agree on. Typed *inside*
 * `options` rather than as a sibling field so the Codex adapter, which already
 * reads `options.reasoningEffort`, keeps working untouched.
 */
const modelSelectionOptionsSchema = v.looseObject({
  reasoningEffort: v.optional(reasoningEffortSchema),
})

export const modelSelectionSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  model: v.pipe(v.string(), v.trim(), v.minLength(1)),
  options: v.optional(modelSelectionOptionsSchema),
})

export const providerUserInputAnswersSchema = v.record(v.string(), v.unknown())
export const providerApprovalDecisionSchema = v.picklist([
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
])

const trimmedText = v.pipe(v.string(), v.trim(), v.minLength(1))

/**
 * How the answer is collected. `text` is the fallback: a provider that ships a
 * question with no options still renders as a free-text field rather than an
 * empty picker.
 */
const userInputAnswerKindSchema = v.picklist(['text', 'single-select', 'multi-select'])

/**
 * `value` is what goes back to the provider, `label` is what the user reads.
 * Codex only sends label + description, so its adapter derives the value — the
 * two stay separate here because a provider that keys answers by opaque id
 * must not be forced to round-trip display text.
 */
export const userInputQuestionOptionSchema = v.looseObject({
  value: trimmedText,
  label: trimmedText,
  description: v.optional(trimmedText),
})

/**
 * One provider question the user has to answer mid-turn. Loose on purpose:
 * unknown provider fields survive the round trip and only `id`/`prompt` are
 * required, so a question shape we have not met yet still parses into
 * something renderable instead of arriving as `unknown`.
 */
export const userInputQuestionSchema = v.looseObject({
  id: trimmedText,
  prompt: trimmedText,
  header: v.optional(trimmedText),
  answerKind: v.optional(userInputAnswerKindSchema, 'text'),
  options: v.optional(v.array(userInputQuestionOptionSchema), []),
  /** A select that also accepts a typed-in answer ("Other"). */
  allowOther: v.optional(v.boolean(), false),
  /** Answer is a credential-shaped value: mask it, never echo it. */
  secret: v.optional(v.boolean(), false),
})

/** The activity payload carries the whole batch, not one question at a time. */
export const userInputQuestionsSchema = v.array(userInputQuestionSchema)

export type RuntimeMode = v.InferOutput<typeof runtimeModeSchema>
export type InteractionMode = v.InferOutput<typeof interactionModeSchema>
export type ProviderDriverKind = v.InferOutput<typeof providerDriverKindSchema>
export type ModelSelection = v.InferOutput<typeof modelSelectionSchema>
export type ModelSelectionOptions = v.InferOutput<typeof modelSelectionOptionsSchema>
export type ProviderUserInputAnswers = v.InferOutput<typeof providerUserInputAnswersSchema>
export type ProviderApprovalDecision = v.InferOutput<typeof providerApprovalDecisionSchema>
export type UserInputAnswerKind = v.InferOutput<typeof userInputAnswerKindSchema>
export type UserInputQuestionOption = v.InferOutput<typeof userInputQuestionOptionSchema>
export type UserInputQuestion = v.InferOutput<typeof userInputQuestionSchema>
export type UserInputQuestions = v.InferOutput<typeof userInputQuestionsSchema>

export const DEFAULT_USER_INPUT_ANSWER_KIND = 'text' satisfies UserInputAnswerKind
export const DEFAULT_RUNTIME_MODE = 'full-access' satisfies RuntimeMode
export const DEFAULT_INTERACTION_MODE = 'default' satisfies InteractionMode
export const DEFAULT_PROVIDER_DRIVER_KIND = 'codex' as ProviderDriverKind
export const DEFAULT_PROVIDER_INSTANCE_ID = 'codex' as ProviderInstanceId
