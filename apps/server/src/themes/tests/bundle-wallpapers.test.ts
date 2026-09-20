import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BUNDLED_THEMES, BUNDLED_WALLPAPERS } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsStore } from '../../settings/store'
import { OMARCHY_THEMES_DIRECTORY, WallpaperLibrary } from '../wallpapers/library'

const roots: string[] = []
const stores: SettingsStore[] = []
const entries = Object.values(BUNDLED_WALLPAPERS)
const sourcePath = (root: string, wallpaper: (typeof entries)[number]) =>
  path.join(root, wallpaper.theme, 'backgrounds', wallpaper.file)
const omarchyInstalled = await stat(OMARCHY_THEMES_DIRECTORY).then(
  (entry) => entry.isDirectory(),
  () => false,
)

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
  const seed = path.join(root, 'themes')
  return { library: new WallpaperLibrary({ directory, settings }), directory, seed }
}

describe('bundled wallpapers', () => {
  it('every bundled theme variant references a wallpaper from the table', () => {
    const assets = new Set(entries.map((entry) => entry.asset))
    for (const theme of BUNDLED_THEMES) {
      for (const variant of Object.values(theme.variants)) {
        expect(variant.wallpaper.enabled).toBe(true)
        expect(variant.wallpaper.source.kind).toBe('library')
        if (variant.wallpaper.source.kind !== 'library') continue
        expect(assets.has(variant.wallpaper.source.asset)).toBe(true)
      }
    }
  })

  it.skipIf(!omarchyInstalled)('the table hashes match the installed Omarchy files', async () => {
    for (const wallpaper of entries) {
      const bytes = await readFile(sourcePath(OMARCHY_THEMES_DIRECTORY, wallpaper))
      expect(createHash('sha256').update(bytes).digest('hex'), wallpaper.file).toBe(wallpaper.asset)
    }
  })

  it.skipIf(!omarchyInstalled)(
    'seed installs a matching file once and reports the rest as missing',
    async () => {
      const { library, directory, seed } = await harness()
      const wallpaper = BUNDLED_WALLPAPERS.catppuccinLight
      const source = sourcePath(seed, wallpaper)
      await mkdir(path.dirname(source), { recursive: true })
      await copyFile(sourcePath(OMARCHY_THEMES_DIRECTORY, wallpaper), source)
      const first = await library.seed(seed)
      expect(first.seeded).toEqual([wallpaper.asset])
      expect(first.mismatched).toEqual([])
      expect(first.missing).toHaveLength(entries.length - 1)
      const asset = await library.read(wallpaper.asset)
      expect(asset.provenance).toEqual([{ kind: 'omarchy', theme: wallpaper.theme, path: source }])
      const second = await library.seed(seed)
      expect(second.seeded).toEqual([])
      expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
    },
  )

  it('seed refuses bytes that do not hash to the bundled id', async () => {
    const { library, directory, seed } = await harness()
    const wallpaper = BUNDLED_WALLPAPERS.graphiteLight
    const source = sourcePath(seed, wallpaper)
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(source, 'not the bundled artwork')
    const result = await library.seed(seed)
    expect(result.seeded).toEqual([])
    expect(result.mismatched).toEqual([source])
    await expect(readdir(directory).catch(() => [])).resolves.toEqual([])
  })
})
