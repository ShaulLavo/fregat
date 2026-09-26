import type { AssetId, ColorMode, ThemeBundle } from '@workspace/contracts'

/** The library wallpaper each half shows, light first; a half without one is left out. */
export function themeWallpapers(
  theme: ThemeBundle,
): readonly { mode: ColorMode; asset: AssetId }[] {
  return (['light', 'dark'] as const).flatMap((mode) => {
    const { enabled, source } = theme.variants[mode].wallpaper
    return enabled && source.kind === 'library' ? [{ mode, asset: source.asset }] : []
  })
}
