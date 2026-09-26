import type {
  ColorMode,
  ProviderInstanceConfig,
  SettingsOperation,
  ThemeCustomization,
  ThemeVariantPatch,
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
