import { archivePartFiles, readArchivePart } from '../archive-parts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assetIdSchema,
  errorStringField,
  BUNDLED_WALLPAPERS,
  bundledWallpaperFor,
  wallpaperAssetSchema,
  type AssetId,
  type BundledWallpaper,
  type WallpaperAsset,
  type WallpaperCatalogEntry,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { SettingsStore } from '../../settings/store'
import {
  decodeWallpaper,
  deriveRendition,
  deriveStoredWallpaper,
  MAX_WALLPAPER_BYTES,
  readWallpaperHeader,
  type WallpaperRendition,
} from './decode'
import { wallpaperErrors } from './structured-errors'
import { readBundledWallpaper } from './bundled'
import { OMARCHY_CATALOG, wallpaperStem } from './omarchy-catalog'

export const OMARCHY_THEMES_DIRECTORY = '/usr/share/omarchy/themes'
type Provenance = WallpaperAsset['provenance'][number]
type SkippedFile = { readonly path: string; readonly code: string }
type Background = { readonly theme: string; readonly source: string }
type WallpaperHeader = Awaited<ReturnType<typeof readWallpaperHeader>>
const SKIPPABLE_CODES: ReadonlySet<string> = new Set(['wallpapers.INVALID', 'wallpapers.TOO_LARGE'])
// What the boot import last saw per source file; a match means the file is not read again.
const IMPORT_MANIFEST = 'omarchy-import.json'
const importManifestSchema = v.record(
  v.string(),
  v.object({ size: v.number(), mtimeMs: v.number() }),
)
type ImportManifest = v.InferOutput<typeof importManifestSchema>

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
    throw wallpaperErrors.NOT_FOUND({ internal: { at: 'directory-for', asset: id } })
  }

  readonly directory: string
  readonly #settings: Pick<SettingsStore, 'snapshot' | 'write'>
  #pending: Promise<unknown> = Promise.resolve()
  readonly #renditions = new Map<string, Promise<void>>()
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

  /** Omarchy wallpapers on GitHub that no library entry covers yet, matched by theme and file stem. */
  catalog(assets: readonly WallpaperAsset[]): WallpaperCatalogEntry[] {
    if (!this.#settings.snapshot().values['workbench.wallpaper.omarchyCatalog']) return []
    const installed = new Set<string>()
    for (const asset of assets) {
      const bundled = bundledWallpaperFor(asset.id)
      if (bundled) installed.add(catalogKey(bundled.theme, bundled.file))
      for (const item of asset.provenance) {
        if (item.kind === 'omarchy') installed.add(catalogKey(item.theme, path.basename(item.path)))
      }
    }
    return OMARCHY_CATALOG.filter((entry) => !installed.has(catalogKey(entry.theme, entry.file)))
  }

  async installCatalog(id: AssetId) {
    const entry = OMARCHY_CATALOG.find((item) => item.asset === id)
    if (!entry) throw wallpaperErrors.NOT_FOUND({ internal: { at: 'catalog', asset: id } })
    const existing = await this.#readIndex(id)
    if (existing) return existing
    // Outside the queue: a stalled GitHub connection must not hold up list, upload or delete.
    const bytes = await this.#download(entry)
    return this.#serialize(() =>
      this.#install(bytes, `${entry.theme} · ${entry.file}`, {
        kind: 'omarchy',
        theme: entry.theme,
        path: entry.source,
      }),
    )
  }

  async #download(entry: WallpaperCatalogEntry) {
    const timeoutMs = this.#settings.snapshot().values['workbench.wallpaper.downloadTimeoutMs']
    const unavailable = (stage: string, cause?: unknown, facts: Record<string, unknown> = {}) =>
      wallpaperErrors.DOWNLOAD({
        cause: cause instanceof Error ? cause : undefined,
        internal: { asset: entry.asset, stage, timeoutMs, ...facts },
      })
    const mismatch = (stage: string, facts: Record<string, unknown>) =>
      wallpaperErrors.DOWNLOAD_MISMATCH({
        internal: { asset: entry.asset, stage, expectedBytes: entry.bytes, ...facts },
      })
    const response = await fetch(entry.source, { signal: AbortSignal.timeout(timeoutMs) }).catch(
      (cause: unknown) => {
        throw unavailable('request', cause)
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw unavailable('status', undefined, { status: response.status })
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) !== entry.bytes) {
      await response.body?.cancel()
      throw mismatch('content-length', { declaredBytes: Number(declared) })
    }
    const bytes = await readCapped(response, entry.bytes).catch((cause: unknown) => {
      throw unavailable('body', cause)
    })
    if (!bytes) throw mismatch('overflow', { limitBytes: entry.bytes })
    if (bytes.byteLength !== entry.bytes) throw mismatch('short', { bytes: bytes.byteLength })
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== entry.asset) throw mismatch('hash', { observed: hash })
    return bytes
  }

  async read(id: AssetId): Promise<WallpaperAsset> {
    const asset = await this.#readIndex(id)
    if (asset) return asset
    const imported = await readArchivePart(await this.archiveDirectories(), 'wallpapers', id)
    if (imported) return v.parse(wallpaperAssetSchema, imported)
    const bundled = bundledWallpaperFor(id)
    if (bundled) return this.#serialize(() => this.#installBundled(bundled))
    throw wallpaperErrors.NOT_FOUND({
      internal: { at: 'read', asset: id, searched: ['user', 'archives', 'bundled'] },
    })
  }

  upload(file: File) {
    if (file.size > MAX_WALLPAPER_BYTES)
      throw wallpaperErrors.TOO_LARGE({
        internal: { at: 'upload', bytes: file.size, limit: MAX_WALLPAPER_BYTES },
      })
    return this.#serialize(async () =>
      this.#install(new Uint8Array(await file.arrayBuffer()), file.name, { kind: 'upload' }),
    )
  }

  async importDirectory(directory: string) {
    const themes: Record<string, AssetId[]> = {}
    const skipped: SkippedFile[] = []
    for (const { theme, source } of await themeBackgrounds(directory)) {
      themes[theme] ??= []
      const name = `${theme} · ${path.basename(source)}`
      const asset = await this.#importFile(source, name, theme, skipped)
      if (asset && !themes[theme].includes(asset.id)) themes[theme].push(asset.id)
    }
    return { themes, skipped }
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

  /**
   * Adds this machine's Omarchy backgrounds as originals alone: renditions are derived on first
   * request. A file whose size and mtime match the last run is not read again.
   */
  async importInstalledOmarchy(directory = OMARCHY_THEMES_DIRECTORY) {
    const present = await stat(directory).then(
      (entry) => entry.isDirectory(),
      () => false,
    )
    if (!present) return null
    const previous = await this.#readImportManifest()
    const seen: ImportManifest = {}
    const counts = { files: 0, read: 0, skipped: 0 }
    for (const { theme, source } of await themeBackgrounds(directory)) {
      const info = await stat(source).catch(() => null)
      if (!info?.isFile()) continue
      counts.files += 1
      seen[source] = { size: info.size, mtimeMs: info.mtimeMs }
      const known = previous[source]
      if (known?.size === info.size && known.mtimeMs === info.mtimeMs) continue
      counts.read += 1
      if (!(await this.#importOriginal(source, theme, info.size))) counts.skipped += 1
      // Background work: let requests run between files.
      await new Promise((resolve) => setImmediate(resolve))
    }
    await this.#writeImportManifest(seen)
    return counts
  }

  delete(id: AssetId) {
    return this.#serialize(async () => {
      if (bundledWallpaperFor(id))
        throw wallpaperErrors.BUNDLED({ internal: { at: 'delete', asset: id } })
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
        [`${id}.${asset.extension}`, `${id}.thumb.webp`, displayName(id), `${id}.colors.json`].map(
          (name) => rm(path.join(this.directory, name), { force: true }),
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

  // One bad file in a seed directory must not cost the rest of the import.
  async #importFile(source: string, name: string, theme: string, skipped: SkippedFile[]) {
    try {
      const { size } = await stat(source)
      if (size > MAX_WALLPAPER_BYTES)
        throw wallpaperErrors.TOO_LARGE({
          internal: { at: 'import', theme, name, bytes: size, limit: MAX_WALLPAPER_BYTES },
        })
      const bytes = await readFile(source)
      return await this.#serialize(() =>
        this.#install(bytes, name, { kind: 'omarchy', theme, path: source }),
      )
    } catch (error) {
      const code = errorCode(error)
      if (!code || !SKIPPABLE_CODES.has(code)) throw error
      skipped.push({ path: source, code })
      return null
    }
  }

  async #importOriginal(source: string, theme: string, size: number) {
    try {
      if (size > MAX_WALLPAPER_BYTES)
        throw wallpaperErrors.TOO_LARGE({
          internal: { at: 'boot-import', theme, bytes: size, limit: MAX_WALLPAPER_BYTES },
        })
      const bytes = await readFile(source)
      const header = await readWallpaperHeader(bytes)
      const name = `${theme} · ${path.basename(source)}`
      await this.#serialize(() =>
        this.#install(bytes, name, { kind: 'omarchy', theme, path: source }, header),
      )
      return true
    } catch (error) {
      const code = errorCode(error)
      if (!code || !SKIPPABLE_CODES.has(code)) throw error
      return false
    }
  }

  // With a `header`, the original is stored alone and its renditions wait for their first request.
  async #install(
    bytes: Uint8Array,
    name: string,
    provenance: Provenance,
    header?: WallpaperHeader,
  ): Promise<WallpaperAsset> {
    const id = parseAssetId(createHash('sha256').update(bytes).digest('hex'))
    const existing = await this.#readIndex(id)
    if (existing) {
      if (!header) await this.#completeDerived(existing, bytes)
      if (existing.provenance.some((item) => JSON.stringify(item) === JSON.stringify(provenance)))
        return existing
      const updated = { ...existing, provenance: [...existing.provenance, provenance] }
      await this.#writeIndex(updated)
      return updated
    }
    const { thumbnail, display, ...metadata } = header
      ? { ...header, thumbnail: null, display: null }
      : await decodeWallpaper(bytes)
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
    if (thumbnail) await writeFile(path.join(this.directory, asset.thumbnail), thumbnail)
    if (display) await writeFile(path.join(this.directory, displayName(id)), display)
    await this.#writeIndex(asset)
    return asset
  }

  /** A rendition's path, derived from the original on first request when an import stored it alone. */
  async rendition(id: AssetId, kind: WallpaperRendition): Promise<string> {
    const asset = await this.read(id)
    const directory = await this.assetDirectory(id)
    const name = kind === 'thumbnail' ? asset.thumbnail : displayName(id)
    const target = path.join(directory, name)
    if (await Bun.file(target).exists()) return target
    if (directory !== this.directory)
      throw wallpaperErrors.NOT_FOUND({ internal: { at: 'rendition', asset: id, kind } })
    const key = `${id}:${kind}`
    let pending = this.#renditions.get(key)
    if (!pending) {
      pending = deriveRendition(path.join(directory, `${id}.${asset.extension}`), kind)
        .then((rendered) => this.writeCache(id, name, rendered))
        .finally(() => this.#renditions.delete(key))
      this.#renditions.set(key, pending)
    }
    await pending
    return target
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

  /** Writes a cache file beside a wallpaper, unless a delete removed the wallpaper meanwhile. */
  writeCache(id: AssetId, name: string, content: string | Uint8Array) {
    return this.#serialize(async () => {
      if (!(await this.#exists(id))) return
      await mkdir(this.directory, { recursive: true })
      const target = path.join(this.directory, name)
      const staging = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(staging, content)
        await rename(staging, target)
      } finally {
        await rm(staging, { force: true })
      }
    })
  }

  async #exists(id: AssetId) {
    if (await this.#readIndex(id)) return true
    return (await readArchivePart(await this.archiveDirectories(), 'wallpapers', id)) !== null
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

  async #readImportManifest(): Promise<ImportManifest> {
    // Missing or unreadable means a full pass, which rewrites it.
    const json: unknown = await readFile(path.join(this.directory, IMPORT_MANIFEST), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null)
    const parsed = v.safeParse(importManifestSchema, json)
    return parsed.success ? parsed.output : {}
  }

  // Renamed into place: a home's library may be hard-linked from another home's.
  async #writeImportManifest(manifest: ImportManifest) {
    await mkdir(this.directory, { recursive: true })
    const target = path.join(this.directory, IMPORT_MANIFEST)
    const staging = `${target}.${randomUUID()}.tmp`
    await writeFile(staging, `${JSON.stringify(manifest, null, 2)}\n`)
    await rename(staging, target)
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

function catalogKey(theme: string, file: string) {
  return `${theme}/${wallpaperStem(file)}`
}

function displayName(id: AssetId) {
  return `${id}.display.webp`
}

/** Every `<theme>/backgrounds/<image>` under a themes directory, by theme then file name. */
async function themeBackgrounds(directory: string): Promise<Background[]> {
  const found: Background[] = []
  for (const theme of await directoryEntries(directory)) {
    if (!theme.isDirectory()) continue
    const backgrounds = path.join(directory, theme.name, 'backgrounds')
    for (const entry of await directoryEntries(backgrounds, true)) {
      if (!entry.isFile() || !/\.(jpe?g|png|webp)$/iu.test(entry.name)) continue
      found.push({ theme: theme.name, source: path.join(backgrounds, entry.name) })
    }
  }
  return found
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export function parseAssetId(input: string): AssetId {
  const result = v.safeParse(assetIdSchema, input)
  if (!result.success)
    throw wallpaperErrors.NOT_FOUND({
      internal: { at: 'parse-asset-id', reason: 'malformed', length: input.length },
    })
  return result.output
}

// Null once the body runs past `limit`; the rest is never read.
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(limit)
  let length = 0
  if (!response.body) return bytes.subarray(0, 0)
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return bytes.subarray(0, length)
    if (length + value.byteLength > limit) {
      await reader.cancel()
      return null
    }
    bytes.set(value, length)
    length += value.byteLength
  }
}

async function directoryEntries(directory: string, optional = false) {
  try {
    return (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  } catch (error) {
    if (optional && error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw wallpaperErrors.DIRECTORY({
      cause: error instanceof Error ? error : undefined,
      internal: { optional, errorCode: errorStringField(error, 'code') },
    })
  }
}
