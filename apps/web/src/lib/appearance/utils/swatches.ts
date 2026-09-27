import { paletteColorsFor, toCss, type ColorMode, type Palette } from '@workspace/contracts'

/** Six colors that identify a palette: its surface, text, accent and three terminal colors. */
export function paletteSwatches(palette: Palette | undefined, mode: ColorMode): readonly string[] {
  if (!palette) return []
  const colors = paletteColorsFor(palette, mode)
  return [
    colors.app.background,
    colors.app.foreground,
    colors.app.primary,
    colors.terminal.red,
    colors.terminal.green,
    colors.terminal.blue,
  ].map(toCss)
}
