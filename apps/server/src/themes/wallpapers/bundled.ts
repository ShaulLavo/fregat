import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BundledWallpaper } from '@workspace/contracts'
import { wallpaperErrors } from './structured-errors'

export const BUNDLED_WALLPAPER_DIRECTORY = fileURLToPath(new URL('./assets/', import.meta.url))

export async function readBundledWallpaper(
  wallpaper: BundledWallpaper,
  directory = BUNDLED_WALLPAPER_DIRECTORY,
) {
  const file = path.join(directory, `${wallpaper.asset}${path.extname(wallpaper.file)}`)
  const bytes = await readFile(file).catch((cause: unknown) => {
    throw wallpaperErrors.BUNDLED_INVALID({
      assetId: wallpaper.asset,
      cause: cause instanceof Error ? cause : undefined,
    })
  })
  if (createHash('sha256').update(bytes).digest('hex') !== wallpaper.asset)
    throw wallpaperErrors.BUNDLED_INVALID({ assetId: wallpaper.asset })
  return { bytes, file }
}
