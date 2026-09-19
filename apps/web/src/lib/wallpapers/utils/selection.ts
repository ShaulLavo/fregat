import type { WallpaperSelection, WallpaperSource } from '@workspace/contracts'

export function selectWallpaper(
  current: WallpaperSelection,
  source: WallpaperSource,
): WallpaperSelection {
  if (source.kind === 'none') return { ...current, enabled: false }
  return { enabled: true, source }
}

export function visibleWallpaper(selection: WallpaperSelection): WallpaperSource {
  return selection.enabled ? selection.source : { kind: 'none' }
}
