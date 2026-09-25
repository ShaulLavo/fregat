import {
  paletteColorsFor,
  toCss,
  type AssetId,
  type ColorMode,
  type Palette,
  type ThemeVariant,
} from '@workspace/contracts'

/** Six colors that identify a theme: its surface, text, accent and three terminal colors. */
export function cardSwatches(palette: Palette | undefined, mode: ColorMode): readonly string[] {
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

/** The library wallpaper a half shows, when it shows one. */
export function cardWallpaper(variant: ThemeVariant): AssetId | null {
  const { enabled, source } = variant.wallpaper
  return enabled && source.kind === 'library' ? source.asset : null
}
