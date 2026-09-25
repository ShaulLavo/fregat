import { mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'

import { SettingsStore } from '../../settings/store'
import { quantize, wallpaperColors } from '../wallpapers/colors'
import { WallpaperLibrary } from '../wallpapers/library'

const roots: string[] = []
const stores: SettingsStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/** Three quarters deep blue, one quarter orange: two clusters with known weights. */
async function twoColorImage() {
  const blue = await sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 20, g: 40, b: 120 } },
  })
    .png()
    .toBuffer()
  return sharp(blue)
    .composite([
      {
        input: await sharp({
          create: { width: 75, height: 200, channels: 3, background: { r: 240, g: 140, b: 20 } },
        })
          .png()
          .toBuffer(),
        left: 225,
        top: 0,
      },
    ])
    .png()
    .toBuffer()
}

it('finds a wallpaper’s colors with their shares, and caches them beside the renditions', async () => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'wallpaper-colors-'))
  roots.push(root)
  const settings = new SettingsStore({
    secretsFilePath: path.join(root, 'secrets.json'),
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
  })
  stores.push(settings)
  const library = new WallpaperLibrary({ directory: path.join(root, 'wallpapers'), settings })
  const asset = await library.upload(new File([await twoColorImage()], 'split.png'))

  const colors = await wallpaperColors(library, asset.id)
  const [heaviest] = colors.clusters
  expect(colors.clusters.reduce((sum, cluster) => sum + cluster.weight, 0)).toBeCloseTo(1)
  expect(heaviest!.color.h).toBeGreaterThan(240)
  expect(heaviest!.color.h).toBeLessThan(280)
  const orange = colors.clusters.filter((cluster) => cluster.color.h > 30 && cluster.color.h < 80)
  expect(orange.reduce((sum, cluster) => sum + cluster.weight, 0)).toBeCloseTo(0.25, 1)
  expect((await readdir(library.directory)).some((name) => name.endsWith('.colors.json'))).toBe(
    true,
  )
  expect(await wallpaperColors(library, asset.id)).toEqual(colors)
})

it('never splits a box of one pixel and returns nothing for an empty image', () => {
  expect(quantize([], 8)).toEqual({ clusters: [] })
  expect(quantize([[0.5, 0, 0]], 8).clusters).toHaveLength(1)
})
