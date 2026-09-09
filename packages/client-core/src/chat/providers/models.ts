import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSnapshot,
  ProviderStatus,
} from '@workspace/contracts'

import {
  applyModelPreferences,
  type ModelPreferences,
} from '@workspace/client-core/chat/providers/preferences'

import {
  modelDefaultEffort,
  modelEffortLevels,
  type ModelEffortLevel,
} from '@workspace/client-core/chat/providers/effort'
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
  modelSelection: ModelSelection
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
    modelSelection: {
      model: model.slug,
      providerInstanceId: provider.providerInstanceId,
    },
    name: model.name,
    providerInstanceId: provider.providerInstanceId,
    providerLabel: provider.displayLabel,
    shortName: model.shortName ?? null,
    statusLabel,
    supportsThinking: model.capabilities?.supportsExtendedThinking === true,
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
