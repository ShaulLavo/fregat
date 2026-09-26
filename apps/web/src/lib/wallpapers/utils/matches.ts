import type { Oklch, WallpaperAsset, WallpaperColors } from '@workspace/contracts'
import { wallpaperMatchScore } from '@workspace/client-core/themes/wallpaper-palette'

/** Wallpapers nearest the draft's background and accent first; ones still being read go last. */
export function sortByMatch(
  assets: readonly WallpaperAsset[],
  colors: ReadonlyMap<string, WallpaperColors>,
  background: Oklch,
  accent: Oklch,
): readonly WallpaperAsset[] {
  const score = (asset: WallpaperAsset) => {
    const found = colors.get(asset.id)
    return found ? wallpaperMatchScore(found, background, accent) : Number.POSITIVE_INFINITY
  }
  return assets.toSorted((left, right) => score(left) - score(right))
}
