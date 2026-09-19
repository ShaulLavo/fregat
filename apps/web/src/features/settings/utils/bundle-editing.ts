import {
  themeIdSchema,
  themeVariants,
  variantFromSettings,
  resolveThemeSettings,
  type ThemeBundle,
  type ThemeDocument,
  type SettingsValues,
} from '@workspace/contracts'
import * as v from 'valibot'

export function newThemeDocument(values: SettingsValues): ThemeDocument {
  const theme = values['workbench.theme']
  const variants = theme
    ? themeVariants(theme, values['workbench.theme.customizations'])
    : {
        light: variantFromSettings(
          resolveThemeSettings({ ...values, 'workbench.colorTheme': 'light' }, 'light'),
          'light',
        ),
        dark: variantFromSettings(
          resolveThemeSettings({ ...values, 'workbench.colorTheme': 'dark' }, 'dark'),
          'dark',
        ),
      }
  return {
    schemaVersion: 1,
    id: v.parse(themeIdSchema, `theme-${crypto.randomUUID()}`),
    name: theme ? `${theme.name} copy` : 'My theme',
    variants,
  }
}
export function previewBundle(document: ThemeDocument): ThemeBundle {
  return { ...document, revision: 'preview', source: 'user' }
}

export const materialLimits = {
  opacity: 100,
  contentOpacity: 100,
  blur: 40,
  saturation: 400,
} as const

export const materialLabels = {
  opacity: 'Pane opacity',
  contentOpacity: 'Content opacity',
  blur: 'Blur',
  saturation: 'Saturation',
} as const
