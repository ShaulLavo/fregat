import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BUNDLED_THEMES, BUNDLED_WALLPAPERS } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsStore } from '../../settings/store'
import { BundleLibrary } from '../bundle-library'
import { PaletteLibrary } from '../palette-library'
import { readBundledWallpaper } from '../wallpapers/bundled'
import { WallpaperLibrary } from '../wallpapers/library'

const roots: string[] = []
const stores: SettingsStore[] = []
const entries = Object.values(BUNDLED_WALLPAPERS)

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'bundle-wallpapers-'))
  roots.push(root)
  const settings = new SettingsStore({
    secretsFilePath: path.join(root, 'secrets.json'),
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
  })
  stores.push(settings)
  const directory = path.join(root, 'wallpapers')
  const library = new WallpaperLibrary({ directory, settings })
  const palettes = new PaletteLibrary({ directory: path.join(root, 'palettes'), settings })
  const bundles = new BundleLibrary({
    directory: path.join(root, 'themes'),
    wallpapers: library,
    palettes,
    settings,
  })
  return { root, library, directory, bundles }
}

describe('bundled wallpapers', () => {
  it('every bundled theme variant references packaged artwork with the expected hash', async () => {
    const assets = new Set(entries.map((entry) => entry.asset))
    for (const theme of BUNDLED_THEMES) {
      for (const variant of Object.values(theme.variants)) {
        expect(variant.wallpaper.enabled).toBe(true)
        expect(variant.wallpaper.source.kind).toBe('library')
        if (variant.wallpaper.source.kind !== 'library') continue
        expect(assets.has(variant.wallpaper.source.asset)).toBe(true)
      }
    }
    for (const wallpaper of entries) {
      const { bytes } = await readBundledWallpaper(wallpaper)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(wallpaper.asset)
    }
  })

  it('exports every built-in theme from a clean library without an Omarchy installation', async () => {
    const { library, bundles } = await harness()
    expect(await library.list()).toEqual([])
    for (const theme of BUNDLED_THEMES) {
      const archive = await bundles.exportArchive(theme.id)
      expect(archive.wallpapers).toHaveLength(2)
      for (const wallpaper of archive.wallpapers) {
        const hash = createHash('sha256')
          .update(Buffer.from(wallpaper.base64, 'base64'))
          .digest('hex')
        expect(hash).toBe(wallpaper.id)
      }
    }
    expect(await library.list()).toHaveLength(entries.length)
  })

  it('saves New from current variants and exports the new theme from a clean library', async () => {
    const { directory, bundles } = await harness()
    const graphite = BUNDLED_THEMES.find((theme) => theme.id === 'graphite')!
    const created = await bundles.create({
      schemaVersion: 1,
      id: 'graphite-copy',
      name: 'Graphite copy',
      variants: graphite.variants,
    })
    expect(created.variants).toEqual(graphite.variants)
    expect((await bundles.exportArchive(created.id)).wallpapers).toHaveLength(2)
    for (const wallpaper of [BUNDLED_WALLPAPERS.graphiteLight, BUNDLED_WALLPAPERS.graphiteDark]) {
      for (const suffix of ['thumb.webp', 'display.webp']) {
        const bytes = await readFile(path.join(directory, `${wallpaper.asset}.${suffix}`))
        expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
      }
    }
  })

  it('a first read waits for background seeding and repeat seeding stays idempotent', async () => {
    const { library, directory } = await harness()
    const pending = library.seed()
    const listing = library.list()
    const wallpaper = entries.at(-1)!
    expect((await library.read(wallpaper.asset)).id).toBe(wallpaper.asset)
    expect((await pending).seeded).toHaveLength(entries.length)
    expect(await listing).toHaveLength(entries.length)
    expect((await library.seed()).seeded).toEqual([])
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(
      entries.length,
    )
    await expect(library.delete(wallpaper.asset)).rejects.toMatchObject({
      data: { code: 'wallpapers.BUNDLED' },
    })
  })

  it('reports missing or corrupt packaged bytes instead of silently disabling artwork', async () => {
    const { root } = await harness()
    const wallpaper = BUNDLED_WALLPAPERS.graphiteLight
    await expect(readBundledWallpaper(wallpaper, root)).rejects.toMatchObject({
      data: { code: 'wallpapers.BUNDLED_INVALID' },
    })
    await writeFile(path.join(root, `${wallpaper.asset}.jpg`), 'not the bundled artwork')
    await expect(readBundledWallpaper(wallpaper, root)).rejects.toMatchObject({
      data: { code: 'wallpapers.BUNDLED_INVALID' },
    })
  })
})
