import type { ScalarSettingOperation } from '../settings/mutations'
import { descriptorFor, type SettingsValues, type SettingId } from '../settings/keys'
import { layerAllowsScope, type SettingsLayer } from '../settings/resolve'
import * as v from 'valibot'
import {
  customizeThemeVariant,
  type ThemeBundle,
  type ThemeCustomizations,
  type ThemeVariant,
  type ThemeVariantPatch,
} from './bundle'
import type { ColorMode } from './palette'

export function themeVariants(theme: ThemeBundle, customizations: ThemeCustomizations) {
  const patches = customizations[theme.id]
  return {
    light: customizeThemeVariant(theme.variants.light, patches?.light),
    dark: customizeThemeVariant(theme.variants.dark, patches?.dark),
  }
}

export function resolveThemeSettings<
  T extends Pick<
    SettingsValues,
    'workbench.theme' | 'workbench.theme.customizations' | 'workbench.colorTheme'
  >,
>(values: T, systemMode: ColorMode, layers: readonly SettingsLayer[] = []): T {
  const theme = values['workbench.theme']
  if (!theme) return values
  const mode =
    values['workbench.colorTheme'] === 'system' ? systemMode : values['workbench.colorTheme']
  const variants = themeVariants(theme, values['workbench.theme.customizations'])
  const active = variants[mode]
  const resolved = {
    ...values,
    'workbench.palette': active.palette,
    'editor.codeTheme.light': variants.light.codeTheme,
    'editor.codeTheme.dark': variants.dark.codeTheme,
    'workbench.wallpaper': active.wallpaper,
    'workbench.surface.opacity': active.material.opacity,
    'workbench.surface.contentOpacity': active.material.contentOpacity,
    'workbench.surface.blur': active.material.blur,
    'workbench.surface.saturation': active.material.saturation,
  }
  return { ...resolved, ...appearanceLayerOverrides(layers) }
}

export function themePartPatch(operation: ScalarSettingOperation): ThemeVariantPatch | null {
  switch (operation.key) {
    case 'workbench.palette':
      return { palette: operation.value }
    case 'editor.codeTheme.light':
    case 'editor.codeTheme.dark':
      return { codeTheme: operation.value }
    case 'workbench.wallpaper':
      return { wallpaper: operation.value }
    case 'workbench.surface.opacity':
      return { material: { opacity: operation.value } }
    case 'workbench.surface.contentOpacity':
      return { material: { contentOpacity: operation.value } }
    case 'workbench.surface.blur':
      return { material: { blur: operation.value } }
    case 'workbench.surface.saturation':
      return { material: { saturation: operation.value } }
    default:
      return null
  }
}

export function variantFromSettings(values: SettingsValues, mode: ColorMode): ThemeVariant {
  return {
    palette: values['workbench.palette'],
    codeTheme: values[mode === 'light' ? 'editor.codeTheme.light' : 'editor.codeTheme.dark'],
    wallpaper: values['workbench.wallpaper'],
    material: {
      opacity: values['workbench.surface.opacity'],
      contentOpacity: values['workbench.surface.contentOpacity'],
      blur: values['workbench.surface.blur'],
      saturation: values['workbench.surface.saturation'],
    },
  }
}

export const THEME_PART_KEYS = [
  'workbench.palette',
  'editor.codeTheme.light',
  'editor.codeTheme.dark',
  'workbench.wallpaper',
  'workbench.surface.opacity',
  'workbench.surface.contentOpacity',
  'workbench.surface.blur',
  'workbench.surface.saturation',
] as const satisfies readonly SettingId[]
function appearanceLayerOverrides(layers: readonly SettingsLayer[]) {
  let overrides: Partial<SettingsValues> = {}
  for (const layer of layers) {
    if (layer.id === 'user') continue
    overrides = { ...overrides, ...appearanceLayerOverride(layer) }
  }
  return overrides
}
function appearanceLayerOverride(layer: SettingsLayer) {
  return Object.fromEntries(
    THEME_PART_KEYS.flatMap((key) => {
      const descriptor = descriptorFor(key)
      if (!layerAllowsScope(layer.id, descriptor.scope)) return []
      const parsed = v.safeParse(descriptor.schema, layer.raw[key])
      return parsed.success ? [[key, parsed.output]] : []
    }),
  )
}
