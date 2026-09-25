import {
  modelRefKey,
  type ModelRef,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderSnapshot,
  type ProviderStatus,
} from '@workspace/contracts'

import {
  applyModelPreferences,
  type ModelPreferences,
} from '@workspace/client-core/chat/providers/preferences'

import {
  modelDefaultEffort,
  modelEffortLevels,
  modelOptionDescriptors,
  type ModelEffortLevel,
} from '@workspace/client-core/chat/providers/options'
import {
  providerRequiresSignIn,
  providerSignInTarget,
  type ProviderSignInTarget,
} from '@workspace/client-core/chat/providers/auth'

/**
 * Why a model cannot be picked. `sign-in` is the one the user can fix from here,
 * so it is a distinct cause rather than another shade of "not ready".
 */
export type ProviderModelDisabledKind =
  | 'disabled'
  | 'not-installed'
  | 'not-ready'
  | 'sign-in'
  | 'unavailable'

export type ProviderModelDisabledReason = {
  readonly kind: ProviderModelDisabledKind
  /** Short line the row shows in place of the provider name. */
  readonly label: string
  /** Full sentence for the tooltip. */
  readonly message: string
}

export type ProviderModelOption = {
  /** The level to preselect, or `null` when the model advertises no default. */
  defaultEffort: string | null
  /** Why the model cannot be picked, or `null` when it can. */
  disabledReason: ProviderModelDisabledReason | null
  driverKind: ProviderDriverKind
  /** The reasoning levels this model advertises. Empty means: show no control. */
  effortLevels: readonly ModelEffortLevel[]
  isCustom: boolean
  key: string
  label: string
  /** A retired model still accepted by id; the picker folds these under their own row. */
  legacy: boolean
  modelSelection: ModelSelection
  optionDescriptors: readonly ProviderOptionDescriptor[]
  name: string
  providerInstanceId: ProviderInstanceId
  providerLabel: string
  shortName: string | null
  statusLabel: string
  /** The model advertises extended thinking, which the row shows as a capability. */
  supportsThinking: boolean
}

export type ProviderModelOptionGroup = {
  displayLabel: string
  /** Drives the rail glyph, so the group carries it rather than each row being asked. */
  driverKind: ProviderDriverKind
  options: ProviderModelOption[]
  providerInstanceId: ProviderInstanceId
  /** Set when the group is blocked on sign-in and the app can start it. */
  signInTarget: ProviderSignInTarget | null
  status: ProviderStatus
}

export function providerModelSelectionKey(modelSelection: ModelSelection) {
  return `${modelSelection.providerInstanceId}:${modelSelection.model}`
}

export function providerModelOptionGroups(
  providers: readonly ProviderSnapshot[] | undefined,
  preferences: ModelPreferences = { hidden: [], order: [] },
): ProviderModelOptionGroup[] {
  if (!providers) return []

  const groups: ProviderModelOptionGroup[] = []
  for (const provider of providers) {
    // Preferences applied per provider, not across the flattened list: the
    // picker groups by provider, so a global reorder could not survive the
    // regrouping anyway.
    const options = applyModelPreferences(providerOptions(provider), preferences)
    if (options.length === 0) continue

    groups.push({
      displayLabel: provider.displayLabel,
      driverKind: provider.driverKind,
      options,
      providerInstanceId: provider.providerInstanceId,
      signInTarget: providerRequiresSignIn(provider) ? providerSignInTarget(provider) : null,
      status: provider.status,
    })
  }

  return groups
}

export function providerModelOptions(
  providers: readonly ProviderSnapshot[] | undefined,
  preferences?: ModelPreferences,
) {
  return providerModelOptionGroups(providers, preferences).flatMap((group) => group.options)
}

/**
 * Every favorite across providers, in starred order. A favorite whose model left
 * its provider's list stays, as unavailable; a hidden one does not show.
 */
export function favoriteModelOptions(
  providers: readonly ProviderSnapshot[] | undefined,
  preferences: ModelPreferences,
): ProviderModelOption[] {
  const favorites = preferences.favorites ?? []
  if (!providers || favorites.length === 0) return []
  const hidden = new Set(preferences.hidden.map(modelRefKey))
  const catalogue = new Map(
    providers
      .flatMap(providerOptions)
      .map((option) => [modelRefKey(option.modelSelection), option]),
  )

  return favorites.flatMap((ref) => {
    const key = modelRefKey(ref)
    if (hidden.has(key)) return []
    const option = catalogue.get(key)
    if (option) return [option]
    const provider = providers.find((entry) => entry.providerInstanceId === ref.providerInstanceId)

    return provider ? [missingFavoriteOption(provider, ref)] : []
  })
}

function missingFavoriteOption(provider: ProviderSnapshot, ref: ModelRef): ProviderModelOption {
  return {
    defaultEffort: null,
    disabledReason: reason(
      'unavailable',
      'No longer offered',
      `${provider.displayLabel} no longer lists ${ref.model}.`,
    ),
    driverKind: provider.driverKind,
    effortLevels: [],
    isCustom: false,
    key: providerModelSelectionKey(ref),
    label: ref.model,
    legacy: false,
    modelSelection: { model: ref.model, providerInstanceId: ref.providerInstanceId },
    optionDescriptors: [],
    name: ref.model,
    providerInstanceId: ref.providerInstanceId,
    providerLabel: provider.displayLabel,
    shortName: null,
    statusLabel: 'Unavailable',
    supportsThinking: false,
  }
}

function providerOptions(provider: ProviderSnapshot): ProviderModelOption[] {
  const disabledReason = providerModelDisabledReason(provider)
  const statusLabel = providerModelOptionStatusLabel(provider)

  return provider.models.map((model) => ({
    defaultEffort: modelDefaultEffort(model),
    disabledReason,
    driverKind: provider.driverKind,
    effortLevels: modelEffortLevels(model),
    isCustom: model.isCustom,
    key: providerModelSelectionKey({
      model: model.slug,
      providerInstanceId: provider.providerInstanceId,
    }),
    label: model.shortName ?? model.name,
    legacy: model.status === 'legacy',
    modelSelection: {
      model: model.slug,
      providerInstanceId: provider.providerInstanceId,
    },
    optionDescriptors: modelOptionDescriptors(model),
    name: model.name,
    providerInstanceId: provider.providerInstanceId,
    providerLabel: provider.displayLabel,
    shortName: model.shortName ?? null,
    statusLabel,
    supportsThinking: modelOptionDescriptors(model).some((option) => option.id === 'thinking'),
  }))
}

// Five independent reasons a model is unpickable, most fundamental first: an
// uninstalled provider is not a signed-out one. Each gets its own sentence so
// the picker can tell the user which one it is instead of just greying the row.
function providerModelDisabledReason(
  provider: ProviderSnapshot,
): ProviderModelDisabledReason | null {
  const name = provider.displayLabel
  if (!provider.enabled) {
    return reason('disabled', 'Disabled in settings', `${name} is disabled in settings.`)
  }
  if (!provider.installed) {
    return reason('not-installed', 'Not installed', `${name} is not installed.`)
  }
  if (provider.availability === 'unavailable') {
    return reason('unavailable', 'Unavailable', `${name} is unavailable right now.`)
  }
  if (providerRequiresSignIn(provider)) {
    return reason(
      'sign-in',
      'Sign in required',
      `${name} is signed out. Sign in to use its models.`,
    )
  }
  if (provider.status === 'ready') return null
  if (provider.status === 'warning') return null

  const message = provider.message ?? `${name} is not ready.`

  return reason('not-ready', message, message)
}

function reason(
  kind: ProviderModelDisabledKind,
  label: string,
  message: string,
): ProviderModelDisabledReason {
  return { kind, label, message }
}

function providerModelOptionStatusLabel(provider: ProviderSnapshot) {
  if (providerRequiresSignIn(provider)) return 'Sign in required'
  if (provider.status === 'ready') return 'Ready'
  if (provider.status === 'warning') return provider.message ?? 'Warning'
  if (provider.status === 'disabled') return 'Disabled'

  return provider.message ?? 'Error'
}
