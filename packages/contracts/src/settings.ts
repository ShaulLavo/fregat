/**
 * Value schemas for the settings registry.
 *
 * The whole-document schema that used to live here is gone: settings are a flat
 * registry of dotted keys now, and each of these is one key's `schema`.
 */
import * as v from 'valibot'
import { providerInstanceIdSchema } from './chat-ids'
import { trimmedNonEmptyStringSchema } from './chat-model'
import { providerDriverKindSchema } from './orchestration-runtime'

const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const KEYBINDING_COMMAND_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/

export const lspFeatureRanksOverrideSchema = v.strictObject({
  completion: v.optional(lspFeatureRankOverrideSchema()),
  hover: v.optional(lspFeatureRankOverrideSchema()),
  navigation: v.optional(lspFeatureRankOverrideSchema()),
  signatureHelp: v.optional(lspFeatureRankOverrideSchema()),
  diagnostics: v.optional(lspFeatureRankOverrideSchema()),
  codeActions: v.optional(lspFeatureRankOverrideSchema()),
  formatting: v.optional(lspFeatureRankOverrideSchema()),
  rename: v.optional(lspFeatureRankOverrideSchema()),
  documentHighlights: v.optional(lspFeatureRankOverrideSchema()),
  semanticTokens: v.optional(lspFeatureRankOverrideSchema()),
})

/**
 * One environment variable handed to a provider process. `value` is stored in
 * the clear, so this is for `PATH`-style knobs, not credentials: nothing here
 * is encrypted and the settings route returns it verbatim.
 */
/**
 * What a stored environment value is replaced with on its way to a client.
 *
 * Provider environment variables are where an API token ends up, and the
 * settings document is served over HTTP. Sending the real value would put every
 * secret in the app behind nothing but an origin check — and into any log,
 * devtools pane or crash report that captures a response body.
 *
 * Sent back unchanged, it means "keep what is stored". Without that rule the
 * first save after a read would overwrite every secret with the mask.
 */
export const REDACTED_SETTINGS_VALUE = '••••••••'

export const providerEnvironmentVariableSchema = v.object({
  name: v.pipe(
    trimmedNonEmptyStringSchema,
    v.maxLength(128),
    v.regex(ENVIRONMENT_VARIABLE_NAME_PATTERN),
  ),
  value: v.optional(v.string(), ''),
})

/**
 * A configured provider instance — the unit the adapter registry reconciles
 * against. `providerInstanceId` is the routing key sessions and runtimes already
 * store; `driverKind` picks the implementation behind it, so two instances of
 * the same driver (`codex-personal`, `codex-work`) are ordinary here.
 *
 * `driverKind` is an open slug on purpose: settings written by a build that
 * knows a driver must still parse in a build that does not. Reconciling that
 * down to "unavailable" is the registry's job, not the contract's.
 *
 * `config` is an opaque, driver-owned envelope. Keeping it unknown here means a
 * driver can grow its own options without a contract change, and an entry for a
 * driver this build cannot load still round-trips through a save untouched.
 */
export const providerInstanceConfigSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  driverKind: providerDriverKindSchema,
  /** `null` keeps the driver's own label instead of pinning a user-facing one. */
  displayLabel: v.optional(v.nullable(trimmedNonEmptyStringSchema), null),
  enabled: v.optional(v.boolean(), true),
  /** Empty string means "resolve the driver's binary from `PATH`". */
  binaryPath: v.optional(v.pipe(v.string(), v.trim()), ''),
  environment: v.optional(v.array(providerEnvironmentVariableSchema), []),
  config: v.optional(v.record(v.string(), v.unknown()), {}),
})

/**
 * Ordered rather than keyed by id: the order is what the provider picker shows.
 * Ids stay unique because the registry routes by them — two entries claiming
 * one id would make routing depend on iteration order.
 */
export const providerInstanceConfigsSchema = v.pipe(
  v.array(providerInstanceConfigSchema),
  v.check(hasUniqueProviderInstanceIds, 'providerInstanceId must be unique across instances'),
)

/** Points at one model of one configured instance. */
export const modelRefSchema = v.object({
  providerInstanceId: providerInstanceIdSchema,
  model: trimmedNonEmptyStringSchema,
})

export const modelRefListSchema = v.pipe(
  v.array(modelRefSchema),
  v.check(hasUniqueModelRefs, 'model references must be unique within a list'),
)

export const keybindingCommandIdSchema = v.pipe(
  trimmedNonEmptyStringSchema,
  v.maxLength(120),
  v.regex(KEYBINDING_COMMAND_ID_PATTERN),
)

export const MAX_KEYBINDING_CHORD_STROKES = 2

// Shape only; the keymap validates each stroke's grammar.
const KEYBINDING_CHORD_PATTERN = /^\S+(?: \S+)?$/

export const keybindingChordSchema = v.pipe(
  trimmedNonEmptyStringSchema,
  v.maxLength(64),
  v.regex(KEYBINDING_CHORD_PATTERN, 'a binding is one hotkey, or two separated by a single space'),
)

/** Most shortcuts one command carries; a longer list is a file written by hand in error. */
export const MAX_KEYBINDINGS_PER_COMMAND = 8

/** A command's complete shortcut list. `null` or `[]` unbinds it; an absent command keeps its defaults. */
export const keybindingListSchema = v.nullable(
  v.pipe(v.array(keybindingChordSchema), v.maxLength(MAX_KEYBINDINGS_PER_COMMAND)),
)

export const keybindingOverridesSchema = v.record(keybindingCommandIdSchema, keybindingListSchema)

/**
 * One entry of the LSP server override table.
 *
 * Every field is optional because an entry may either replace a built-in
 * server's command or only adjust it: `{ disabled: true }` removes a bundled
 * server, `{ extensions: ['.foo'] }` widens one, and a `command` with no
 * matching built-in id registers a new server outright.
 *
 * `env` is stored in the clear — this is for `PATH`-style knobs, not
 * credentials. Anything secret belongs in the secret store, which is what keeps
 * the settings document safe to read, export and hand to an agent.
 */
export const lspServerOverrideSchema = v.object({
  /** argv, binary first. An empty array is rejected: it would spawn nothing. */
  command: v.optional(v.pipe(v.array(trimmedNonEmptyStringSchema), v.minLength(1))),
  disabled: v.optional(v.boolean(), false),
  env: v.optional(
    v.record(v.pipe(v.string(), v.regex(ENVIRONMENT_VARIABLE_NAME_PATTERN)), v.string()),
  ),
  extensions: v.optional(v.array(trimmedNonEmptyStringSchema)),
  features: v.optional(lspFeatureRanksOverrideSchema),
  initialization: v.optional(v.record(v.string(), v.unknown())),
})

/**
 * Server id → override. Keyed rather than a list because the id is what the
 * registry merges on, and two entries claiming one id would make the result
 * depend on iteration order.
 */
export const lspServerOverridesSchema = v.record(
  trimmedNonEmptyStringSchema,
  lspServerOverrideSchema,
)

/** Extension → ordered server ids; `!id` removes and `...` retains automatic matches. */
export const lspLanguageServerListsSchema = v.record(
  trimmedNonEmptyStringSchema,
  v.array(trimmedNonEmptyStringSchema),
)

/**
 * Server id → whether that server's semantic tokens are requested.
 *
 * Deliberately a separate table from `lspServerOverridesSchema` rather than a
 * field on it: an override entry replaces how a server *starts*, and a stopped
 * server keeps its entry, whereas this decides only whether a request is issued
 * to a server that is already running. Merging them would make turning colour
 * off for one server look like reconfiguring its command.
 */
export const semanticTokenServerOverridesSchema = v.record(trimmedNonEmptyStringSchema, v.boolean())

export type LspServerOverride = v.InferOutput<typeof lspServerOverrideSchema>
export type LspServerOverrides = v.InferOutput<typeof lspServerOverridesSchema>
/** Read-only consumer view of the stored language-server lists. */
export type LspLanguageServerLists = Readonly<Record<string, readonly string[]>>
export type SemanticTokenServerOverrides = v.InferOutput<typeof semanticTokenServerOverridesSchema>
export type ProviderEnvironmentVariable = v.InferOutput<typeof providerEnvironmentVariableSchema>
export type ProviderInstanceConfig = v.InferOutput<typeof providerInstanceConfigSchema>
export type ModelRef = v.InferOutput<typeof modelRefSchema>
/** Readonly, so a stored value and a candidate list built by the page both fit. */
export type KeybindingOverrides = Readonly<Record<string, readonly string[] | null>>

function lspFeatureRankOverrideSchema() {
  return v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))
}

/** Stable identity for a model across the hidden and order lists. */
export function modelRefKey(ref: ModelRef): string {
  return `${ref.providerInstanceId} ${ref.model}`
}

function hasUniqueProviderInstanceIds(instances: ProviderInstanceConfig[]): boolean {
  const seen = new Set<string>()

  for (const instance of instances) {
    if (seen.has(instance.providerInstanceId)) return false
    seen.add(instance.providerInstanceId)
  }

  return true
}

function hasUniqueModelRefs(refs: ModelRef[]): boolean {
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = modelRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
  }

  return true
}
