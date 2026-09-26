import type { WallpaperAsset, WallpaperCatalogEntry } from '@workspace/contracts'

type WallpaperGroup = {
  readonly id: string
  readonly heading: string
  readonly assets: readonly WallpaperAsset[]
  readonly catalog: readonly WallpaperCatalogEntry[]
}

export type WallpaperSections = {
  readonly uploads: readonly WallpaperAsset[]
  readonly themes: readonly WallpaperGroup[]
}

function isUploadedWallpaper(asset: WallpaperAsset) {
  return asset.provenance.some((item) => item.kind === 'upload')
}

function importedTheme(asset: WallpaperAsset) {
  for (const item of asset.provenance) {
    if (item.kind === 'omarchy') return item.theme
  }
  return null
}

const THEME_SEPARATOR = ' · '

function titleCase(slug: string) {
  return slug
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => word[0]!.toLocaleUpperCase() + word.slice(1))
    .join(' ')
}

// "catppuccin · 1-totoro.png" → "totoro". The theme is the section heading already.
export function wallpaperDisplayName(asset: WallpaperAsset) {
  const separator = asset.name.lastIndexOf(THEME_SEPARATOR)
  const base = separator < 0 ? asset.name : asset.name.slice(separator + THEME_SEPARATOR.length)
  return fileLabel(base) || asset.name
}

export function catalogDisplayName(entry: WallpaperCatalogEntry) {
  return fileLabel(entry.file) || entry.file
}

function fileLabel(base: string) {
  return base
    .replace(/\.(jpe?g|png|webp)$/iu, '')
    .replace(/^\d+[-_\s]+/u, '')
    .replace(/[-_]+/gu, ' ')
    .trim()
}

export function wallpaperTitle(asset: WallpaperAsset) {
  return `${asset.name} · ${asset.width} × ${asset.height}`
}

function matches(asset: WallpaperAsset, heading: string, query: string) {
  if (!query) return true
  return `${heading} ${asset.name}`.toLocaleLowerCase().includes(query)
}

export function wallpaperSections(
  assets: readonly WallpaperAsset[],
  search = '',
  catalog: readonly WallpaperCatalogEntry[] = [],
): WallpaperSections {
  const query = search.trim().toLocaleLowerCase()
  const uploads: WallpaperAsset[] = []
  const themes = new Map<string, WallpaperAsset[]>()
  const downloads = new Map<string, WallpaperCatalogEntry[]>()
  for (const asset of assets) {
    if (isUploadedWallpaper(asset)) {
      if (matches(asset, 'uploads', query)) uploads.push(asset)
      continue
    }
    const theme = importedTheme(asset) ?? 'other'
    if (!matches(asset, theme, query)) continue
    const grouped = themes.get(theme)
    if (grouped) grouped.push(asset)
    else themes.set(theme, [asset])
  }
  for (const entry of catalog) {
    if (query && !`${entry.theme} ${entry.file}`.toLocaleLowerCase().includes(query)) continue
    const grouped = downloads.get(entry.theme)
    if (grouped) grouped.push(entry)
    else downloads.set(entry.theme, [entry])
    if (!themes.has(entry.theme)) themes.set(entry.theme, [])
  }
  return {
    uploads,
    themes: [...themes].map(([id, grouped]) => ({
      id,
      heading: titleCase(id),
      assets: grouped,
      catalog: downloads.get(id) ?? [],
    })),
  }
}
