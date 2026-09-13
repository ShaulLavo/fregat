import type { QueryClient } from '@tanstack/react-query'
import type { SettingsOperation, SettingsSnapshot, SettingsValues } from '@workspace/contracts'

import {
  activeSettingsIntentsFor,
  type ActiveSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

type ColorTheme = SettingsValues['workbench.colorTheme']

export function readLiveSettingsProjection(queryClient: QueryClient, fallback?: SettingsSnapshot) {
  const confirmed = queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document()) ?? fallback
  if (!confirmed) return undefined

  return projectSettings(confirmed, activeSettingsIntentsFor(queryClient))
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
