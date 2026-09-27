import type { SettingId } from '../settings/keys'

/** The settings a theme sets, each saved per theme and mode once a theme is selected. */
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
export type ThemePartKey = (typeof THEME_PART_KEYS)[number]
