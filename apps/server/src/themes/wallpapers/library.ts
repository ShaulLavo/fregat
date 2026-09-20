import { archivePartFiles, readArchivePart } from '../archive-parts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assetIdSchema,
  BUNDLED_WALLPAPERS,
  bundledWallpaperFor,
  wallpaperAssetSchema,
  type AssetId,
  type BundledWallpaper,
  type WallpaperAsset,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { SettingsStore } from '../../settings/store'
import { decodeWallpaper, deriveStoredWallpaper, MAX_WALLPAPER_BYTES } from './decode'
import { wallpaperErrors } from './structured-errors'
import { readBundledWallpaper } from './bundled'

export const OMARCHY_THEMES_DIRECTORY = '/usr/share/omarchy/themes'
type Provenance = WallpaperAsset['provenance'][number]
type SkippedFile = { readonly path: string; readonly code: string }
const SKIPPABLE_CODES: ReadonlySet<string> = new Set(['wallpapers.INVALID', 'wallpapers.TOO_LARGE'])

export class WallpaperLibrary {
  assertUnused: (id: string) => Promise<void> = async () => {}
  archiveDirectories: () => Promise<string[]> = async () => []

  async assetDirectory(id: AssetId): Promise<string> {
    if (await Bun.file(path.join(this.directory, `${id}.json`)).exists()) return this.directory
    for (const directory of await this.archiveDirectories()) {
      const folder = path.join(directory, 'wallpapers')
      if (await Bun.file(path.join(folder, `${id}.json`)).exists()) return folder
    }
    if (bundledWallpaperFor(id)) {
      await this.read(id)
      return this.directory
    }
    throw wallpaperErrors.NOT_FOUND()
  }

  readonly directory: string
  readonly #settings: Pick<SettingsStore, 'snapshot' | 'write'>
  #pending: Promise<unknown> = Promise.resolve()
  // Keyed on the directory mtime so a write from the curation script is still seen.
  #listing: { readonly mtimeMs: number; readonly assets: WallpaperAsset[] } | null = null

  constructor(options: { directory: string; settings: Pick<SettingsStore, 'snapshot' | 'write'> }) {
    this.directory = options.directory
    this.#settings = options.settings
  }

  async list(): Promise<WallpaperAsset[]> {
    await this.#pending
    const local = await this.localAssets()
    const imported = await Promise.all(
      (await archivePartFiles(await this.archiveDirectories(), 'wallpapers')).map(async (file) =>
        v.parse(wallpaperAssetSchema, JSON.parse(await readFile(file, 'utf8'))),
      ),
    )
    return [...new Map([...imported, ...local].map((asset) => [asset.id, asset])).values()].sort(
      (a, b) => a.name.localeCompare(b.name),
    )
  }

  private async localAssets(): Promise<WallpaperAsset[]> {
    await mkdir(this.directory, { recursive: true })
    const { mtimeMs } = await stat(this.directory)
    if (this.#listing?.mtimeMs === mtimeMs) return this.#listing.assets
    const names = (await readdir(this.directory))
      .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
      .sort()
    const assets = await Promise.all(
      names.map(async (name) =>
        v.parse(
          wallpaperAssetSchema,
          JSON.parse(await readFile(path.join(this.directory, name), 'utf8')),
        ),
      ),
    )
    assets.sort((a, b) => a.name.localeCompare(b.name))
    this.#listing = { mtimeMs, assets }
    return assets
  }

  async read(id: AssetId): Promise<WallpaperAsset> {
    const asset = await this.#readIndex(id)
    if (asset) return asset
    const imported = await readArchivePart(await this.archiveDirectories(), 'wallpapers', id)
    if (imported) return v.parse(wallpaperAssetSchema, imported)
    const bundled = bundledWallpaperFor(id)
    if (bundled) return this.#serialize(() => this.#installBundled(bundled))
    throw wallpaperErrors.NOT_FOUND()
  }

  upload(file: File) {
    if (file.size > MAX_WALLPAPER_BYTES) throw wallpaperErrors.TOO_LARGE()
    return this.#serialize(async () =>
      this.#install(new Uint8Array(await file.arrayBuffer()), file.name, { kind: 'upload' }),
    )
  }

  importDirectory(directory: string) {
    return this.#serialize(async () => {
      const themes: Record<string, AssetId[]> = {}
      const skipped: SkippedFile[] = []
      for (const theme of await directoryEntries(directory)) {
        if (!theme.isDirectory()) continue
        themes[theme.name] = await this.#importTheme(directory, theme.name, skipped)
      }
      return { themes, skipped }
    })
  }

  seed() {
    return this.#serialize(async () => {
      const seeded: AssetId[] = []
      for (const wallpaper of Object.values(BUNDLED_WALLPAPERS)) {
        if (await this.#readIndex(wallpaper.asset)) continue
        const asset = await this.#installBundled(wallpaper)
        seeded.push(asset.id)
      }
      return { seeded }
    })
  }

  delete(id: AssetId) {
    return this.#serialize(async () => {
      if (bundledWallpaperFor(id)) throw wallpaperErrors.BUNDLED()
      await this.assertUnused(id)
      const asset = await this.read(id)
      const selection = this.#settings.snapshot().values['workbench.wallpaper']
      if (selection.source.kind === 'library' && selection.source.asset === id) {
        await this.#settings.write({
          mutationId: `wallpaper-delete:${randomUUID()}`,
          target: 'user',
          operations: [
            {
              key: 'workbench.wallpaper',
              kind: 'set',
              value: { enabled: false, source: { kind: 'desktop' } },
            },
          ],
        })
      }
      this.#listing = null
      await rm(path.join(this.directory, `${id}.json`))
      await Promise.all(
        [`${id}.${asset.extension}`, `${id}.thumb.webp`, displayName(id)].map((name) =>
          rm(path.join(this.directory, name), { force: true }),
        ),
      )
      return { deleted: id, settings: this.#settings.snapshot() }
    })
  }

  async #installBundled(wallpaper: BundledWallpaper) {
    const { bytes, file } = await readBundledWallpaper(wallpaper)
    return this.#install(bytes, `${wallpaper.theme} · ${wallpaper.file}`, {
      kind: 'omarchy',
      theme: wallpaper.theme,
      path: file,
    })
  }

  async #importTheme(directory: string, theme: string, skipped: SkippedFile[]) {
    const backgrounds = path.join(directory, theme, 'backgrounds')
    const entries = await directoryEntries(backgrounds, true)
    const assets: AssetId[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(jpe?g|png|webp)$/iu.test(entry.name)) continue
      const source = path.join(backgrounds, entry.name)
      const asset = await this.#importFile(source, `${theme} · ${entry.name}`, theme, skipped)
      if (asset) assets.push(asset.id)
    }
    return [...new Set(assets)]
  }

  // One bad file in a seed directory must not cost the rest of the import.
  async #importFile(source: string, name: string, theme: string, skipped: SkippedFile[]) {
    try {
      if ((await stat(source)).size > MAX_WALLPAPER_BYTES) throw wallpaperErrors.TOO_LARGE()
      return await this.#install(await readFile(source), name, {
        kind: 'omarchy',
        theme,
        path: source,
      })
    } catch (error) {
      const code = errorCode(error)
      if (!code || !SKIPPABLE_CODES.has(code)) throw error
      skipped.push({ path: source, code })
      return null
    }
  }

  async #install(bytes: Uint8Array, name: string, provenance: Provenance): Promise<WallpaperAsset> {
    const id = parseAssetId(createHash('sha256').update(bytes).digest('hex'))
    const existing = await this.#readIndex(id)
    if (existing) {
      await this.#completeDerived(existing, bytes)
      if (existing.provenance.some((item) => JSON.stringify(item) === JSON.stringify(provenance)))
        return existing
      const updated = { ...existing, provenance: [...existing.provenance, provenance] }
      await this.#writeIndex(updated)
      return updated
    }
    const { thumbnail, display, ...metadata } = await decodeWallpaper(bytes)
    await mkdir(this.directory, { recursive: true })
    const asset: WallpaperAsset = {
      id,
      name,
      ...metadata,
      thumbnail: `${id}.thumb.webp`,
      provenance: [provenance],
      redistribution: 'unverified',
    }
    await writeFile(path.join(this.directory, `${id}.${asset.extension}`), bytes)
    await writeFile(path.join(this.directory, asset.thumbnail), thumbnail)
    await writeFile(path.join(this.directory, displayName(id)), display)
    await this.#writeIndex(asset)
    return asset
  }

  // Same bytes, same id: a repeat install is the moment to write a derived file the entry lacks.
  async #completeDerived(asset: WallpaperAsset, bytes: Uint8Array) {
    const missing = await Promise.all(
      [asset.thumbnail, displayName(asset.id)].map(async (name) => {
        const exists = await stat(path.join(this.directory, name)).then(
          () => true,
          () => false,
        )
        return exists ? null : name
      }),
    )
    if (missing.every((name) => name === null)) return
    const derived = await deriveStoredWallpaper(bytes)
    if (missing[0]) await writeFile(path.join(this.directory, missing[0]), derived.thumbnail)
    if (missing[1]) await writeFile(path.join(this.directory, missing[1]), derived.display)
  }

  async #readIndex(id: AssetId): Promise<WallpaperAsset | null> {
    try {
      return v.parse(
        wallpaperAssetSchema,
        JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8')),
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async #writeIndex(asset: WallpaperAsset) {
    this.#listing = null
    const target = path.join(this.directory, `${asset.id}.json`)
    const staging = `${target}.${randomUUID()}.tmp`
    await writeFile(staging, `${JSON.stringify(asset, null, 2)}\n`)
    await rename(staging, target)
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation)
    this.#pending = result.catch(() => undefined)
    return result
  }
}

export function displayName(id: AssetId) {
  return `${id}.display.webp`
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export function parseAssetId(input: string): AssetId {
  const result = v.safeParse(assetIdSchema, input)
  if (!result.success) throw wallpaperErrors.NOT_FOUND()
  return result.output
}

async function directoryEntries(directory: string, optional = false) {
  try {
    return (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  } catch (error) {
    if (optional && error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw wallpaperErrors.DIRECTORY()
  }
}
