import { createClientError } from '@workspace/client-core/errors'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import {
  deriveWriteTarget,
  themePartPatch,
  resolveThemeSettings,
  type ColorMode,
  type SettingsOperation,
} from '@workspace/contracts'

type ThemeOperation = Extract<
  SettingsOperation,
  { readonly kind: 'set'; readonly key: 'workbench.palette' | 'workbench.colorTheme' }
>

export async function setThemePreference(
  owner: SettingsOwner,
  operation: ThemeOperation,
  mode: ColorMode = 'dark',
) {
  const projection = owner.getSnapshot().projection
  if (
    resolveThemeSettings(projection.values, mode, projection.layers)[operation.key] ===
    operation.value
  )
    return true
  const target = deriveWriteTarget(operation.key, projection.layers)
  const theme = projection.values['workbench.theme']
  const patch = themePartPatch(operation)
  let change: SettingsOperation = operation
  if (theme && patch && target === 'user')
    change = { kind: 'theme.customize', id: theme.id, mode, patch }
  const submission = owner.submit(target, [change], 'tui.color-theme')
  if (submission.kind === 'noop') return false
  const outcome = await submission.settled
  if (outcome === 'acknowledged') return true
  if (outcome === 'discarded') return false
  throw createClientError({
    code: 'tui.THEME_WRITE_FAILED',
    status: 409,
    message: 'Could not save the color preference.',
    why: 'The settings owner could not acknowledge this change.',
    fix: 'Retry or discard the failed change in Settings.',
  })
}
