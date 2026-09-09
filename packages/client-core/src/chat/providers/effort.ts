import type { ModelSelection, ModelSelectionOptions, ProviderModel } from '@workspace/contracts'

/** One reasoning level a model advertises, ready to render. */
export type ModelEffortLevel = {
  /** The provider's own copy for the level, when it ships one. */
  readonly description: string | null
  readonly effort: string
  readonly label: string
}

/**
 * The effort-relevant slice of a model. `ProviderModelOption` satisfies it
 * structurally, so the reconciler takes a picker row without this module having
 * to depend on the picker's own type.
 */
export type ModelEffortCapability = {
  readonly defaultEffort: string | null
  readonly effortLevels: readonly ModelEffortLevel[]
}

/** One value a descriptor accepts. Always a string, whatever gets persisted. */
type ModelOptionChoice = {
  /** The provider's own copy for the choice, when it ships one. */
  readonly description: string | null
  readonly label: string
  readonly value: string
}

/**
 * One knob a model exposes on `ModelSelection.options`. The UI renders and
 * reads every knob through this shape, so a second option costs a descriptor
 * rather than a second control: `reasoningEffort` was the only key any surface
 * knew how to write, which is why `supportsExtendedThinking` was advertised
 * with nothing to act on it.
 *
 * `kind` is a storage contract, not a look: adapters read `thinking` as a real
 * boolean (see the Claude adapter's `thinkingSelection`), so a boolean
 * descriptor persists `true`/`false` rather than its choice ids.
 */
export type ModelOptionDescriptor = {
  readonly choices: readonly ModelOptionChoice[]
  /**
   * What the control shows as active while the selection carries nothing. It is
   * never written on the user's behalf — adapters read an absent value as "send
   * nothing", and preselecting one for real would start pinning it.
   */
  readonly defaultValue: string | null
  /** The `ModelSelection.options` key this descriptor owns. */
  readonly id: string
  readonly kind: 'boolean' | 'select'
  readonly label: string
}

const REASONING_EFFORT_OPTION = 'reasoningEffort'
const THINKING_OPTION = 'thinking'
const BOOLEAN_ON = 'on'
const BOOLEAN_OFF = 'off'

const BOOLEAN_CHOICES: readonly ModelOptionChoice[] = [
  { description: null, label: 'On', value: BOOLEAN_ON },
  { description: null, label: 'Off', value: BOOLEAN_OFF },
]

// Effort ids are open strings — Codex adds levels on its own schedule — so the
// label is derived, not looked up. The map only covers ids whose display form is
// not simply the id with a capital first letter.
const EFFORT_LABEL_OVERRIDES: Record<string, string> = { xhigh: 'X-High' }

/**
 * Every option the model advertises, in the order the composer shows them. A
 * model that advertises nothing yields nothing: no control must ever invent a
 * knob no provider offered.
 */
export function modelOptionDescriptors(
  model: Pick<ProviderModel, 'capabilities'>,
): ModelOptionDescriptor[] {
  const descriptors: ModelOptionDescriptor[] = []
  const effortLevels = modelEffortLevels(model)
  if (effortLevels.length > 0) {
    descriptors.push(
      modelEffortDescriptor({ defaultEffort: modelDefaultEffort(model), effortLevels }),
    )
  }
  if (model.capabilities?.supportsExtendedThinking !== true) return descriptors

  descriptors.push({
    choices: BOOLEAN_CHOICES,
    // No default: absent means "leave the provider's own thinking setting
    // alone", which is a third state neither On nor Off can express.
    defaultValue: null,
    id: THINKING_OPTION,
    kind: 'boolean',
    label: 'Extended thinking',
  })

  return descriptors
}

/** The effort descriptor for a ladder the caller already resolved. */
export function modelEffortDescriptor(capability: ModelEffortCapability): ModelOptionDescriptor {
  return {
    choices: capability.effortLevels.map((level) => ({
      description: level.description,
      label: level.label,
      value: level.effort,
    })),
    defaultValue: capability.defaultEffort,
    id: REASONING_EFFORT_OPTION,
    kind: 'select',
    label: 'Reasoning effort',
  }
}

/**
 * The levels a model actually advertises. A model that advertises none yields
 * none: the picker must never invent a level no provider offered.
 */
export function modelEffortLevels(model: Pick<ProviderModel, 'capabilities'>): ModelEffortLevel[] {
  const advertised = model.capabilities?.reasoningEfforts ?? []

  return advertised.map((option) => ({
    description: effortDescription(option.description),
    effort: option.effort,
    label: modelEffortLabel(option.effort),
  }))
}

/**
 * The level the picker preselects. Only a default the model also advertises
 * counts — a default with no row to check is dead data, and rendering a row for
 * it would put a level on screen the provider never offered.
 */
export function modelDefaultEffort(model: Pick<ProviderModel, 'capabilities'>): string | null {
  const fallback = model.capabilities?.defaultReasoningEffort ?? null
  if (!fallback) return null

  const advertised = model.capabilities?.reasoningEfforts ?? []

  return advertised.some((option) => option.effort === fallback) ? fallback : null
}

export function modelSelectionEffort(selection: ModelSelection | null | undefined): string | null {
  return selection?.options?.reasoningEffort ?? null
}

/** The chosen value for one descriptor, or `null` when the selection carries none. */
export function modelSelectionOptionValue(
  selection: ModelSelection | null | undefined,
  descriptor: ModelOptionDescriptor,
): string | null {
  const stored = selection?.options?.[descriptor.id]
  if (descriptor.kind === 'boolean') {
    return typeof stored === 'boolean' ? booleanChoiceValue(stored) : null
  }

  return typeof stored === 'string' ? stored : null
}

/**
 * Writes a descriptor's value into the selection's options, which is the one
 * home every adapter reads and the per-session projection already persists.
 * `null` clears it, and an options bag left empty is dropped rather than
 * serialized.
 */
export function withModelOption(
  selection: ModelSelection,
  descriptor: ModelOptionDescriptor,
  value: string | null,
): ModelSelection {
  return withModelOptionValue(selection, descriptor.id, storedOptionValue(descriptor, value))
}

export function withModelEffort(selection: ModelSelection, effort: string | null): ModelSelection {
  return withModelOptionValue(selection, REASONING_EFFORT_OPTION, effort)
}

/**
 * Carries the chosen level onto a newly picked model. A level the new model does
 * not advertise is never carried across — its own default takes over, and a
 * model that advertises nothing drops the level entirely. Choosing nothing stays
 * nothing: the adapters treat an absent level as "send no effort at all", so
 * preselecting a default here would silently start pinning it.
 */
export function reconcileModelEffort(
  previous: ModelSelection | null,
  next: ModelSelection,
  capability: ModelEffortCapability,
): ModelSelection {
  const current = modelSelectionEffort(previous)
  if (!current) return withModelEffort(next, null)
  if (capability.effortLevels.some((level) => level.effort === current)) {
    return withModelEffort(next, current)
  }

  return withModelEffort(next, capability.defaultEffort)
}

export function modelEffortLabel(effort: string): string {
  const override = EFFORT_LABEL_OVERRIDES[effort]
  if (override) return override

  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

function storedOptionValue(
  descriptor: ModelOptionDescriptor,
  value: string | null,
): string | boolean | null {
  if (value === null) return null
  if (descriptor.kind === 'boolean') return value === BOOLEAN_ON

  return value
}

function booleanChoiceValue(stored: boolean) {
  return stored ? BOOLEAN_ON : BOOLEAN_OFF
}

function withModelOptionValue(
  selection: ModelSelection,
  key: string,
  value: string | boolean | null,
): ModelSelection {
  const options = optionsWithout(selection.options, key)
  if (value !== null) options[key] = value

  const base = { model: selection.model, providerInstanceId: selection.providerInstanceId }
  if (Object.keys(options).length === 0) return base

  return { ...base, options }
}

function effortDescription(description: string | undefined): string | null {
  const trimmed = description?.trim() ?? ''
  if (!trimmed) return null

  return trimmed
}

function optionsWithout(options: ModelSelectionOptions | undefined, key: string) {
  if (!options) return {} as ModelSelectionOptions

  // Every other key belongs to some adapter, so the bag is copied whole and only
  // the one key being written is removed.
  const rest = { ...options }
  delete rest[key]

  return rest
}
