import * as v from 'valibot'
import { providerInstanceIdSchema, type ProviderInstanceId } from './chat-ids'
import {
  providerDriverKindSchema,
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

const providerOptionChoiceSchema = v.object({
  id: trimmedNonEmptyStringSchema,
  label: trimmedNonEmptyStringSchema,
  description: v.optional(trimmedNonEmptyStringSchema),
  isDefault: v.optional(v.boolean()),
})

const providerOptionDescriptorBase = {
  id: trimmedNonEmptyStringSchema,
  label: trimmedNonEmptyStringSchema,
  description: v.optional(trimmedNonEmptyStringSchema),
}

export const providerOptionDescriptorSchema = v.variant('type', [
  v.object({
    ...providerOptionDescriptorBase,
    type: v.literal('select'),
    options: v.array(providerOptionChoiceSchema),
    currentValue: v.optional(trimmedNonEmptyStringSchema),
    promptInjectedValues: v.optional(v.array(trimmedNonEmptyStringSchema)),
  }),
  v.object({
    ...providerOptionDescriptorBase,
    type: v.literal('boolean'),
    currentValue: v.optional(v.boolean()),
  }),
])

const providerModelCapabilitiesSchema = v.object({
  optionDescriptors: v.optional(v.array(providerOptionDescriptorSchema)),
})

/** `legacy` is a retired model still accepted by id; absent means current. */
const providerModelStatusSchema = v.picklist(['current', 'legacy'])

export const providerModelSchema = v.object({
  slug: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
  shortName: v.optional(trimmedNonEmptyStringSchema),
  isCustom: v.boolean(),
  status: v.optional(providerModelStatusSchema),
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

/** One live background task: a background shell, a monitor or a backgrounded subagent. */
export const providerBackgroundTaskSchema = v.object({
  taskId: trimmedNonEmptyStringSchema,
  taskType: v.string(),
  description: v.string(),
})

/** `supported` is false when the session's provider cannot list or stop background tasks. */
export const providerBackgroundTasksSchema = v.object({
  supported: v.boolean(),
  tasks: v.array(providerBackgroundTaskSchema),
})

export const providerMcpServerStatusSchema = v.picklist([
  'connected',
  'failed',
  'needs-auth',
  'pending',
  'disabled',
])

export const providerMcpServerSchema = v.object({
  name: trimmedNonEmptyStringSchema,
  status: providerMcpServerStatusSchema,
  error: v.nullable(v.string()),
})

/**
 * A session's MCP servers as its provider reports them. `running` is false when
 * the session has no live provider process to ask; the lists are then empty.
 */
export const providerSessionMcpSchema = v.object({
  running: v.boolean(),
  canReconnect: v.boolean(),
  canSignIn: v.boolean(),
  servers: v.array(providerMcpServerSchema),
})

export const providerMcpSignInSchema = v.object({ authorizationUrl: v.string() })

export const providerConfiguredHookSchema = v.object({
  eventName: v.string(),
  matcher: v.nullable(v.string()),
  handler: v.string(),
  sourcePath: v.string(),
  enabled: v.boolean(),
})

/** Hooks configured for a session's checkout. Claude reads its own settings files and lists none. */
export const providerSessionHooksSchema = v.object({
  running: v.boolean(),
  supported: v.boolean(),
  hooks: v.array(providerConfiguredHookSchema),
  errors: v.array(v.string()),
})

export type ProviderMcpServer = v.InferOutput<typeof providerMcpServerSchema>
export type ProviderMcpServerStatus = v.InferOutput<typeof providerMcpServerStatusSchema>
export type ProviderSessionMcp = v.InferOutput<typeof providerSessionMcpSchema>
export type ProviderMcpSignIn = v.InferOutput<typeof providerMcpSignInSchema>
export type ProviderConfiguredHook = v.InferOutput<typeof providerConfiguredHookSchema>
export type ProviderSessionHooks = v.InferOutput<typeof providerSessionHooksSchema>
export type ProviderBackgroundTask = v.InferOutput<typeof providerBackgroundTaskSchema>
export type ProviderBackgroundTasks = v.InferOutput<typeof providerBackgroundTasksSchema>
export type ProviderSignInMethod = v.InferOutput<typeof providerSignInMethodSchema>
export type ProviderLoginState = v.InferOutput<typeof providerLoginStateSchema>
export type ProviderLoginAttempt = v.InferOutput<typeof providerLoginAttemptSchema>
export type ProviderAuthResult = v.InferOutput<typeof providerAuthResultSchema>
export type ProviderStatus = v.InferOutput<typeof providerStatusSchema>
export type ProviderAuth = v.InferOutput<typeof providerAuthSchema>
export type ProviderOptionChoice = v.InferOutput<typeof providerOptionChoiceSchema>
export type ProviderOptionDescriptor = v.InferOutput<typeof providerOptionDescriptorSchema>
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
