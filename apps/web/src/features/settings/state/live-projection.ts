import { resolveThemeSettings } from '@workspace/contracts'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { hashKey, type QueryClient } from '@tanstack/react-query'
import type {
  SettingId,
  SettingsOperation,
  SettingsSnapshot,
  SettingsValues,
} from '@workspace/contracts'

import {
  activeSettingsIntentsFor,
  settingsIntentStore,
  type ActiveSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import { readSettingBootValue } from '@/lib/settings-boot-mirror'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

type ColorTheme = SettingsValues['workbench.colorTheme']

export function readLiveSettingsProjection(queryClient: QueryClient, fallback?: SettingsSnapshot) {
  const confirmed = queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document()) ?? fallback
  if (!confirmed) return undefined

  const projected = projectSettings(confirmed, activeSettingsIntentsFor(queryClient))
  if (!projected.values['workbench.theme']) return projected

  return {
    ...projected,
    values: resolveThemeSettings(projected.values, systemColorMode(), projected.layers),
  }
}

type LiveSettings = ReturnType<typeof readLiveSettingsProjection>

/**
 * Hands `listener` the live projection now and after every change to the confirmed document or
 * to the settings intents, so optimistic writes reach it at once, as they reach `useSettingValue`.
 */
export function subscribeLiveSettings(
  queryClient: QueryClient,
  listener: (settings: LiveSettings) => void,
): () => void {
  const documentHash = hashKey(settingsKeys.document())
  const notify = () => listener(readLiveSettingsProjection(queryClient))
  // The cache also reports observer and fetch-state events; only a new document changes the values.
  let document = queryClient.getQueryData(settingsKeys.document())
  const stopDocument = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== documentHash) return
    const next = queryClient.getQueryData(settingsKeys.document())
    if (next === document) return
    document = next
    notify()
  })
  const stopIntents = settingsIntentStore.subscribe(notify)
  notify()
  return () => {
    stopDocument()
    stopIntents()
  }
}

/** Applies one setting now and whenever it changes, with its boot value until the document lands. */
export function watchSettingValue<K extends SettingId>(
  queryClient: QueryClient,
  key: K,
  apply: (value: SettingsValues[K]) => void,
): () => void {
  let applied: { readonly value: SettingsValues[K] } | null = null
  return subscribeLiveSettings(queryClient, (settings) => {
    const value = settings?.values[key] ?? readSettingBootValue(key)
    if (applied && Object.is(applied.value, value)) return
    applied = { value }
    apply(value)
  })
}

export function readLiveColorTheme(queryClient: QueryClient, fallback?: ColorTheme) {
  const projection = readLiveSettingsProjection(queryClient)
  if (projection) return projection.values['workbench.colorTheme']

  return replayActiveColorTheme(activeSettingsIntentsFor(queryClient), fallback)
}

function replayActiveColorTheme(
  active: readonly ActiveSettingsIntent[],
  fallback?: ColorTheme,
): ColorTheme | undefined {
  let theme = fallback
  for (const entry of active.toSorted((left, right) => left.sequence - right.sequence)) {
    for (const operation of entry.patch.request.operations) {
      theme = colorThemeAfterOperation(theme, operation)
    }
  }

  return theme
}

function colorThemeAfterOperation(
  current: ColorTheme | undefined,
  operation: SettingsOperation,
): ColorTheme | undefined {
  if (operation.kind === 'set' && operation.key === 'workbench.colorTheme') {
    return operation.value
  }
  if (operation.kind === 'reset' && operation.keys.includes('workbench.colorTheme'))
    return undefined

  return current
}
