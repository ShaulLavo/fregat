import {
  settingRowIds,
  themePartSlot,
  type ColorMode,
  type ProviderInstanceConfig,
  type SettingId,
  type SettingsLayer,
  type SettingsOperation,
  type SettingsValues,
  type SettingsWriteTarget,
  type ThemeCustomization,
  type ThemeVariantPatch,
} from '@workspace/contracts'

export function providerEnabledOperation(
  instance: ProviderInstanceConfig,
  enabled: boolean,
): SettingsOperation {
  return {
    createIfMissing: {
      binaryPath: instance.binaryPath,
      config: instance.config,
      displayLabel: instance.displayLabel,
      driverKind: instance.driverKind,
      environment: instance.environment.map(({ name }) => ({ name, value: '' })),
    },
    enabled,
    kind: 'provider.setEnabled',
    providerInstanceId: instance.providerInstanceId,
  }
}

/** The customization a theme keeps: each half's changes from the theme, dropping unchanged halves. */
export function themeCustomization(
  patches: Readonly<Record<ColorMode, ThemeVariantPatch | null>>,
): ThemeCustomization {
  return {
    ...(patches.light ? { light: patches.light } : {}),
    ...(patches.dark ? { dark: patches.dark } : {}),
  }
}

/**
 * Reset's writes for one row. Under a theme a part leaves the theme's customization for the shown
 * mode, so it follows the theme again; a value written before the theme was picked goes too.
 */
export function resetSettingOperations(
  key: SettingId,
  settings: {
    readonly values: Pick<SettingsValues, 'workbench.theme'>
    readonly layers: readonly SettingsLayer[]
  },
  target: SettingsWriteTarget,
  shownMode: ColorMode,
): readonly SettingsOperation[] {
  const theme = settings.values['workbench.theme']
  const slot = theme && target === 'user' ? themePartSlot(key, shownMode) : null
  if (!theme || !slot) return [{ kind: 'reset', keys: settingRowIds(key) }]
  const uncustomize: SettingsOperation = { kind: 'theme.uncustomize', id: theme.id, ...slot }
  const stray = settings.layers.some(
    (layer) => layer.id === 'user' && Object.hasOwn(layer.raw, key),
  )
  return stray ? [uncustomize, { kind: 'reset', keys: [key] }] : [uncustomize]
}
