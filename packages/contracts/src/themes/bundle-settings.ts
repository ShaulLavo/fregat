import type { ScalarSettingOperation } from '../settings/mutations'
import { descriptorFor, type SettingId, type SettingsValues } from '../settings/keys'
import { layerAllowsScope, type SettingsLayer } from '../settings/resolve'
import * as v from 'valibot'
import {
  customizeThemeVariant,
  type ThemeBundle,
  type ThemeCustomizations,
  type ThemePart,
  type ThemeVariant,
  type ThemeVariantPatch,
} from './bundle'
import type { ColorMode } from './palette'
import { THEME_PART_KEYS, type ThemePartKey } from './part-keys'

export function themeVariants(theme: ThemeBundle, customizations: ThemeCustomizations) {
  const patches = customizations[theme.id]
  return {
    light: customizeThemeVariant(theme.variants.light, patches?.light),
    dark: customizeThemeVariant(theme.variants.dark, patches?.dark),
  }
}

/** The half of a theme on screen: the chosen mode, or the system's while following it. */
export function shownColorMode(
  preference: SettingsValues['workbench.colorTheme'],
  systemMode: ColorMode,
): ColorMode {
  return preference === 'system' ? systemMode : preference
}

export function resolveThemeSettings<
  T extends Pick<
    SettingsValues,
    'workbench.theme' | 'workbench.theme.customizations' | 'workbench.colorTheme'
  >,
>(values: T, systemMode: ColorMode, layers: readonly SettingsLayer[] = []): T {
  const theme = values['workbench.theme']
  if (!theme) return values
  const mode = shownColorMode(values['workbench.colorTheme'], systemMode)
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

const THEME_PART_OF_KEY = {
  'workbench.palette': 'palette',
  'editor.codeTheme.light': 'codeTheme',
  'editor.codeTheme.dark': 'codeTheme',
  'workbench.wallpaper': 'wallpaper',
  'workbench.surface.opacity': 'material.opacity',
  'workbench.surface.contentOpacity': 'material.contentOpacity',
  'workbench.surface.blur': 'material.blur',
  'workbench.surface.saturation': 'material.saturation',
} as const satisfies Record<ThemePartKey, ThemePart>

/** Where a setting lives in a theme's customization: the half on screen, or the code theme's own. */
export function themePartSlot(
  key: SettingId,
  shownMode: ColorMode,
): { readonly mode: ColorMode; readonly part: ThemePart } | null {
  if (!Object.hasOwn(THEME_PART_OF_KEY, key)) return null
  const part = THEME_PART_OF_KEY[key as ThemePartKey]
  if (key === 'editor.codeTheme.light') return { mode: 'light', part }
  if (key === 'editor.codeTheme.dark') return { mode: 'dark', part }
  return { mode: shownMode, part }
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
