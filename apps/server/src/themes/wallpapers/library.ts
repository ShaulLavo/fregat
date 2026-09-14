import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assetIdSchema,
  wallpaperAssetSchema,
  type AssetId,
  type WallpaperAsset,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { SettingsStore } from '../../settings/store'
import { decodeWallpaper, MAX_WALLPAPER_BYTES } from './decode'
import { wallpaperErrors } from './structured-errors'

export const OMARCHY_THEMES_DIRECTORY = '/usr/share/omarchy/themes'
type Provenance = WallpaperAsset['provenance'][number]

export class WallpaperLibrary {
  readonly directory: string
  readonly #settings: Pick<SettingsStore, 'snapshot' | 'write'>
  #pending: Promise<unknown> = Promise.resolve()

  constructor(options: { directory: string; settings: Pick<SettingsStore, 'snapshot' | 'write'> }) {
    this.directory = options.directory
    this.#settings = options.settings
  }

  async list(): Promise<WallpaperAsset[]> {
    await mkdir(this.directory, { recursive: true })
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
    return assets.sort((a, b) => a.name.localeCompare(b.name))
  }

  async read(id: AssetId): Promise<WallpaperAsset> {
    const asset = await this.#readIndex(id)
    if (!asset) throw wallpaperErrors.NOT_FOUND()
    return asset
  }

  upload(file: File) {
    if (file.size > MAX_WALLPAPER_BYTES) throw wallpaperErrors.TOO_LARGE()
    return this.#serialize(async () =>
      this.#install(new Uint8Array(await file.arrayBuffer()), file.name, { kind: 'upload' }),
    )
  }

  importDirectory(directory: string) {
    return this.#serialize(async () => {
      const mapping: Record<string, AssetId[]> = {}
      const themes = await directoryEntries(directory)
      for (const theme of themes) {
        if (!theme.isDirectory()) continue
        mapping[theme.name] = await this.#importTheme(directory, theme.name)
      }
      return mapping
    })
  }

  delete(id: AssetId) {
    return this.#serialize(async () => {
      const asset = await this.read(id)
      const selection = this.#settings.snapshot().values['workbench.wallpaper']
      const light = releaseSource(selection.light, id)
      const dark = releaseSource(selection.dark, id)
      if (light !== selection.light || dark !== selection.dark) {
        await this.#settings.write({
          mutationId: `wallpaper-delete:${randomUUID()}`,
          target: 'user',
          operations: [{ key: 'workbench.wallpaper', kind: 'set', value: { light, dark } }],
        })
      }
      await rm(path.join(this.directory, `${id}.json`))
      await Promise.all(
        [`${id}.${asset.extension}`, `${id}.thumb.webp`].map((name) =>
          rm(path.join(this.directory, name), { force: true }),
        ),
      )
      return { deleted: id, settings: this.#settings.snapshot() }
    })
  }

  async #importTheme(directory: string, theme: string) {
    const backgrounds = path.join(directory, theme, 'backgrounds')
    const entries = await directoryEntries(backgrounds, true)
    const assets: AssetId[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(jpe?g|png|webp)$/iu.test(entry.name)) continue
      const source = path.join(backgrounds, entry.name)
      if ((await stat(source)).size > MAX_WALLPAPER_BYTES) throw wallpaperErrors.TOO_LARGE()
      const asset = await this.#install(await readFile(source), `${theme} · ${entry.name}`, {
        kind: 'omarchy',
        theme,
        path: source,
      })
      assets.push(asset.id)
    }
    return [...new Set(assets)]
  }

  async #install(bytes: Uint8Array, name: string, provenance: Provenance): Promise<WallpaperAsset> {
    const id = parseAssetId(createHash('sha256').update(bytes).digest('hex'))
    const existing = await this.#readIndex(id)
    if (existing) {
      if (existing.provenance.some((item) => JSON.stringify(item) === JSON.stringify(provenance)))
        return existing
      const updated = { ...existing, provenance: [...existing.provenance, provenance] }
      await this.#writeIndex(updated)
      return updated
    }
    const { thumbnail, ...metadata } = await decodeWallpaper(bytes)
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
    await this.#writeIndex(asset)
    return asset
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

function releaseSource(source: import('@workspace/contracts').WallpaperSource, id: AssetId) {
  if (source.kind === 'library' && source.asset === id) return { kind: 'none' } as const
  return source
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
