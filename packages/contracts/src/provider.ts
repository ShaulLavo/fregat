import * as v from 'valibot'
import { providerInstanceIdSchema, type ProviderInstanceId } from './chat-ids'
import {
  providerDriverKindSchema,
  reasoningEffortSchema,
  runtimeModeSchema,
  type ProviderDriverKind,
} from './orchestration-runtime'
import { isoDateTimeSchema, trimmedNonEmptyStringSchema } from './chat-model'

const providerAuthStatusSchema = v.picklist(['authenticated', 'unauthenticated', 'unknown'])
const providerStatusSchema = v.picklist(['ready', 'warning', 'error', 'disabled'])
const providerAvailabilitySchema = v.picklist(['available', 'unavailable'])

const providerAuthSchema = v.object({
  status: providerAuthStatusSchema,
  type: v.optional(trimmedNonEmptyStringSchema),
  label: v.optional(trimmedNonEmptyStringSchema),
  email: v.optional(trimmedNonEmptyStringSchema),
})

/**
 * Sign-in methods a provider can start from inside the app. The names are ours;
 * each adapter maps them onto its CLI's own flags (`claude auth login
 * --claudeai|--console|--sso`).
 */
export const providerSignInMethodSchema = v.picklist(['subscription', 'console', 'sso'])

export const providerSignInBodySchema = v.object({
  method: providerSignInMethodSchema,
  email: v.optional(trimmedNonEmptyStringSchema),
})

const providerLoginStateSchema = v.picklist(['pending', 'succeeded', 'failed', 'cancelled'])

/**
 * A single in-app sign-in run. `pending` means a browser window is open and the
 * user has not finished yet, so the client polls this record until it settles.
 */
export const providerLoginAttemptSchema = v.object({
  attemptId: trimmedNonEmptyStringSchema,
  providerInstanceId: providerInstanceIdSchema,
  method: providerSignInMethodSchema,
  state: providerLoginStateSchema,
  startedAt: isoDateTimeSchema,
  completedAt: v.nullable(isoDateTimeSchema),
  message: v.optional(trimmedNonEmptyStringSchema),
  outputTail: v.array(v.string()),
})

export const providerAuthResultSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  auth: providerAuthSchema,
  checkedAt: isoDateTimeSchema,
  supportsSignIn: v.boolean(),
  signInMethods: v.array(providerSignInMethodSchema),
})

/**
 * One reasoning level a model accepts. `effort` is an open string, not a shared
 * enum: Codex advertises `low..ultra` and adds levels on its own schedule, and
 * a closed picklist would fail the whole snapshot and empty the model list.
 * `description` is the provider's own copy for the level, when it ships one.
 */
const modelReasoningEffortOptionSchema = v.object({
  effort: reasoningEffortSchema,
  description: v.optional(v.string()),
})

/**
 * What a model advertises about how it can be run. Every field is optional so a
 * model that advertises nothing still parses. Key names match what the Codex
 * adapter already emits from `model/list`.
 */
const providerModelCapabilitiesSchema = v.object({
  defaultReasoningEffort: v.optional(v.nullable(reasoningEffortSchema)),
  reasoningEfforts: v.optional(v.array(modelReasoningEffortOptionSchema)),
  supportsExtendedThinking: v.optional(v.boolean()),
})

export const providerModelSchema = v.object({
  slug: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
  shortName: v.optional(trimmedNonEmptyStringSchema),
  isCustom: v.boolean(),
  capabilities: v.optional(v.nullable(providerModelCapabilitiesSchema), null),
})

const providerTraitsSchema = v.object({
  supportsApprovals: v.boolean(),
  supportsFullAccess: v.boolean(),
  supportsInterrupt: v.boolean(),
  supportsSessionStop: v.boolean(),
  supportsStreaming: v.boolean(),
  supportsUserInput: v.boolean(),
})

const providerInstanceSettingsSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  driverKind: providerDriverKindSchema,
  displayLabel: trimmedNonEmptyStringSchema,
  enabled: v.boolean(),
  runtimeModes: v.array(runtimeModeSchema),
  traits: providerTraitsSchema,
})

export const providerSnapshotSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  driverKind: providerDriverKindSchema,
  displayLabel: trimmedNonEmptyStringSchema,
  enabled: v.boolean(),
  installed: v.boolean(),
  version: v.nullable(trimmedNonEmptyStringSchema),
  status: providerStatusSchema,
  auth: providerAuthSchema,
  checkedAt: isoDateTimeSchema,
  message: v.optional(trimmedNonEmptyStringSchema),
  availability: v.optional(providerAvailabilitySchema),
  models: v.array(providerModelSchema),
  runtimeModes: v.array(runtimeModeSchema),
  traits: providerTraitsSchema,
  /**
   * Optional rather than part of `traits` on purpose: `traits` describes what a
   * turn can do, and every construction site of it would have to change. This
   * says only whether `/providers/:id/auth/login` exists for this provider.
   */
  supportsSignIn: v.optional(v.boolean()),
  showInteractionModeToggle: v.optional(v.boolean()),
})

export const providerListResultSchema = v.object({
  providers: v.array(providerSnapshotSchema),
})

/**
 * One slash command a provider advertises. `name` never carries the leading
 * slash: the composer owns that character, and providers disagree about whether
 * it belongs to the name.
 */
const providerSlashCommandSchema = v.object({
  name: trimmedNonEmptyStringSchema,
  description: v.optional(trimmedNonEmptyStringSchema),
  /** The provider's own copy for the argument it expects, e.g. `<file>`. */
  argumentHint: v.optional(trimmedNonEmptyStringSchema),
  /** Other names that resolve to the same command (`/cost` -> `/usage`). */
  aliases: v.optional(v.array(trimmedNonEmptyStringSchema)),
})

/**
 * One `$skill`. Skills live on the user's disk and are discovered per working
 * directory, so a catalog only means anything next to the `cwd` it was read for.
 * `enabled` is carried rather than filtered away because a disabled skill is
 * worth showing as unavailable instead of pretending it does not exist.
 */
const providerSkillSchema = v.object({
  name: trimmedNonEmptyStringSchema,
  description: v.optional(trimmedNonEmptyStringSchema),
  /** Directory the skill was loaded from, when the provider reports one. */
  path: v.optional(trimmedNonEmptyStringSchema),
  /** Where it came from — a plugin name, `user`, `project`, ... */
  scope: v.optional(trimmedNonEmptyStringSchema),
  enabled: v.boolean(),
})

export const providerCommandCatalogSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  commands: v.array(providerSlashCommandSchema),
  skills: v.array(providerSkillSchema),
  /**
   * False when the provider cannot answer at all — no listing path, or the probe
   * failed. Discovery only feeds a menu, so the read degrades to an empty
   * catalog instead of an error and reports the degradation here.
   */
  supported: v.boolean(),
})

export type ProviderSignInMethod = v.InferOutput<typeof providerSignInMethodSchema>
export type ProviderLoginState = v.InferOutput<typeof providerLoginStateSchema>
export type ProviderLoginAttempt = v.InferOutput<typeof providerLoginAttemptSchema>
export type ProviderAuthResult = v.InferOutput<typeof providerAuthResultSchema>
export type ProviderStatus = v.InferOutput<typeof providerStatusSchema>
export type ProviderAuth = v.InferOutput<typeof providerAuthSchema>
export type ModelReasoningEffortOption = v.InferOutput<typeof modelReasoningEffortOptionSchema>
export type ProviderModelCapabilities = v.InferOutput<typeof providerModelCapabilitiesSchema>
export type ProviderModel = v.InferOutput<typeof providerModelSchema>
export type ProviderInstanceSettings = v.InferOutput<typeof providerInstanceSettingsSchema>
export type ProviderSnapshot = v.InferOutput<typeof providerSnapshotSchema>
export type ProviderListResult = v.InferOutput<typeof providerListResultSchema>
export type ProviderSlashCommand = v.InferOutput<typeof providerSlashCommandSchema>
export type ProviderSkill = v.InferOutput<typeof providerSkillSchema>
export type ProviderCommandCatalog = v.InferOutput<typeof providerCommandCatalogSchema>

export const DEFAULT_CODEX_PROVIDER_SETTINGS = {
  displayLabel: 'Codex',
  driverKind: 'codex' as ProviderDriverKind,
  enabled: true,
  providerInstanceId: 'codex' as ProviderInstanceId,
  runtimeModes: ['full-access'],
  traits: {
    supportsApprovals: true,
    supportsFullAccess: true,
    supportsInterrupt: true,
    supportsSessionStop: true,
    supportsStreaming: true,
    supportsUserInput: true,
  },
} satisfies ProviderInstanceSettings

export const DEFAULT_CLAUDE_PROVIDER_SETTINGS = {
  displayLabel: 'Claude Code',
  driverKind: 'claude' as ProviderDriverKind,
  enabled: true,
  providerInstanceId: 'claude' as ProviderInstanceId,
  runtimeModes: ['full-access', 'approval-required', 'auto-accept-edits'],
  traits: {
    supportsApprovals: true,
    supportsFullAccess: true,
    supportsInterrupt: true,
    supportsSessionStop: true,
    supportsStreaming: true,
    // The agent SDK has no analog of codex's `item/tool/requestUserInput`.
    supportsUserInput: false,
  },
} satisfies ProviderInstanceSettings
