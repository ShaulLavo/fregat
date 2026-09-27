import { THEME_PART_KEYS, type ColorMode, type SettingId } from '@workspace/contracts'

/**
 * Which half of the selected theme a row edits, for the parts a theme holds one of per mode.
 * Code themes have a key per mode, so they need no note; with no theme a part serves both modes.
 */
export function themePartModeNote(id: SettingId, themed: boolean, mode: ColorMode): string | null {
  if (!themed || id === 'editor.codeTheme.light' || id === 'editor.codeTheme.dark') return null
  if (!THEME_PART_KEYS.some((key) => key === id)) return null
  return mode === 'dark' ? 'Dark mode.' : 'Light mode.'
}
