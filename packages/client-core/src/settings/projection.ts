import {
  REDACTED_SETTINGS_VALUE,
  applySettingsOperations,
  resolveSettings,
  type ProviderInstanceConfig,
  type SettingsDiagnostic,
  type SettingsLayerId,
  type SettingsSnapshot,
  type SettingsValues,
} from '@workspace/contracts'

import type { ActiveSettingsIntent } from './intent-store'

export type SettingsProjectionLayer = {
  readonly id: SettingsLayerId
  readonly present: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export type SettingsProjection = {
  readonly acknowledgedMutationIds: readonly string[]
  readonly diagnostics: readonly SettingsDiagnostic[]
  readonly layers: readonly SettingsProjectionLayer[]
  readonly pendingMutationIds: readonly string[]
  readonly values: SettingsValues
}

export function projectSettings(
  confirmed: SettingsSnapshot,
  active: readonly ActiveSettingsIntent[],
): SettingsProjection {
  const ordered = active.toSorted((left, right) => left.sequence - right.sequence)
  const pending = ordered.filter((entry) => entry.status === 'pending')
  const acknowledgedMutationIds = ordered.flatMap((entry) =>
    entry.status === 'acknowledged' ? [entry.intentId] : [],
  )
  if (pending.length === 0) {
    return {
      acknowledgedMutationIds,
      diagnostics: confirmed.diagnostics,
      layers: projectionLayers(confirmed),
      pendingMutationIds: [],
      values: confirmed.values,
    }
  }

  const layers = replayPendingIntents(confirmed, pending)
  const resolution = resolveSettings(layers, { previous: confirmed.values })

  return {
    acknowledgedMutationIds,
    diagnostics: resolution.diagnostics,
    layers,
    pendingMutationIds: pending.map((entry) => entry.intentId),
    values: maskProjectedProviderSecrets(resolution.values, confirmed.values),
  }
}

function replayPendingIntents(
  confirmed: SettingsSnapshot,
  pending: readonly ActiveSettingsIntent[],
): SettingsProjectionLayer[] {
  let layers = projectionLayers(confirmed)
  for (const entry of pending) layers = applyIntentToLayers(layers, entry)

  return layers
}

function projectionLayers(confirmed: SettingsSnapshot): SettingsProjectionLayer[] {
  return confirmed.layers.map(({ id, present, raw }) => ({ id, present, raw }))
}

function applyIntentToLayers(
  layers: readonly SettingsProjectionLayer[],
  entry: ActiveSettingsIntent,
): SettingsProjectionLayer[] {
  return layers.map((layer) => {
    if (layer.id !== entry.patch.request.target) return layer

    const reduction = applySettingsOperations(layer.raw, entry.patch.request.operations)
    if (reduction.raw === layer.raw) return layer

    return { ...layer, present: true, raw: reduction.raw }
  })
}

function maskProjectedProviderSecrets(
  projected: SettingsValues,
  confirmed: SettingsValues,
): SettingsValues {
  const projectedProviders = projected['providers.instances']
  const maskedProviders = projectedProviders.map((instance) =>
    maskProjectedProvider(instance, confirmed['providers.instances']),
  )
  if (maskedProviders.every((instance, index) => instance === projectedProviders[index])) {
    return projected
  }

  return { ...projected, 'providers.instances': maskedProviders }
}

function maskProjectedProvider(
  projected: ProviderInstanceConfig,
  confirmed: readonly ProviderInstanceConfig[],
): ProviderInstanceConfig {
  const confirmedInstance = confirmed.find(
    (instance) => instance.providerInstanceId === projected.providerInstanceId,
  )
  if (!confirmedInstance) return projected

  const environment = projected.environment.map((variable) => {
    const confirmedVariable = confirmedInstance.environment.find(
      (candidate) => candidate.name === variable.name,
    )
    if (confirmedVariable?.value !== REDACTED_SETTINGS_VALUE) return variable

    return { ...variable, value: REDACTED_SETTINGS_VALUE }
  })
  if (environment.every((variable, index) => variable === projected.environment[index])) {
    return projected
  }

  return { ...projected, environment }
}
