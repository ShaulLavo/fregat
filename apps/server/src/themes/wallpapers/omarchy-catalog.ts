import { assetIdSchema, type WallpaperCatalogEntry } from '@workspace/contracts'
import * as v from 'valibot'
import catalog from './omarchy-catalog.json'

// Regenerate with `bun run themes:omarchy-catalog`; the pinned commit keeps every hash stable.
const catalogSchema = v.object({
  repository: v.string(),
  commit: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)),
  wallpapers: v.array(
    v.object({
      theme: v.string(),
      file: v.string(),
      asset: assetIdSchema,
      bytes: v.pipe(v.number(), v.integer(), v.minValue(1)),
    }),
  ),
})

const parsed = v.parse(catalogSchema, catalog)

export const OMARCHY_CATALOG: readonly WallpaperCatalogEntry[] = parsed.wallpapers.map((entry) => ({
  ...entry,
  source: `https://raw.githubusercontent.com/${parsed.repository}/${parsed.commit}/themes/${entry.theme}/backgrounds/${entry.file}`,
}))

/** "1-totoro.webp" → "1-totoro": Omarchy re-encodes backgrounds, so the stem outlives the format. */
export function wallpaperStem(file: string) {
  return file.replace(/\.(jpe?g|png|webp)$/iu, '')
}
