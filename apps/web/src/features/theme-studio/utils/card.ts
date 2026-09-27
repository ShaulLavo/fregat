import type { AssetId, ThemeVariant } from '@workspace/contracts'

/** The library wallpaper a half shows, when it shows one. */
export function cardWallpaper(variant: ThemeVariant): AssetId | null {
  const { enabled, source } = variant.wallpaper
  return enabled && source.kind === 'library' ? source.asset : null
}
