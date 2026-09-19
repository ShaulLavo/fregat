import type { AssetId, WallpaperSource } from '@workspace/contracts'

const ITEM_PREFIX = 'wallpaper:'

export function wallpaperItemValue(source: WallpaperSource) {
  return `${ITEM_PREFIX}${source.kind === 'library' ? source.asset : source.kind}`
}

export function wallpaperSourceFromItemValue(value: string): WallpaperSource | null {
  if (!value.startsWith(ITEM_PREFIX)) return null
  const id = value.slice(ITEM_PREFIX.length)
  if (id === 'none' || id === 'desktop') return { kind: id }
  return { kind: 'library', asset: id as AssetId }
}
