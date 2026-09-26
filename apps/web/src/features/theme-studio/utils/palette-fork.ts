import type { ColorMode, Palette, PaletteColors } from '@workspace/contracts'
import { duplicatePalette, paletteIdFromName } from '@workspace/client-core/themes/palette-editing'

/** A user copy of `source`, named after the theme and half it was made for. */
export function forkPalette(
  source: Palette,
  themeName: string,
  mode: ColorMode,
  taken: readonly string[],
): Palette {
  const name = `${themeName} ${mode === 'dark' ? 'Dark' : 'Light'}`
  return duplicatePalette(source, paletteIdFromName(name, taken), name)
}

/** The palette with one half's colors replaced; a single-mode palette has only the one. */
export function withModeColors(palette: Palette, mode: ColorMode, colors: PaletteColors): Palette {
  const { variants } = palette
  if (variants.kind === 'single') return { ...palette, variants: { ...variants, colors } }
  return { ...palette, variants: { ...variants, [mode]: colors } }
}
