import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUNDLED_WALLPAPERS } from '@workspace/contracts'
import { readBundledWallpaper } from '../src/themes/wallpapers/bundled'

const assets = await Promise.all(
  Object.values(BUNDLED_WALLPAPERS).map((wallpaper) => readBundledWallpaper(wallpaper)),
)
const destination = path.join(import.meta.dirname, '../dist/assets')
await mkdir(destination, { recursive: true })
await Promise.all(
  assets.map(({ bytes, file }) => writeFile(path.join(destination, path.basename(file)), bytes)),
)
