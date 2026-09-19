import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import {
  SYNTAX_THEME_MODES,
  bundledPalette,
  parsePalette,
  serializePalette,
  paletteSupportsMode,
  themeArchiveSchema,
  themeDocumentSchema,
  themeBundleSchema,
  themeIdSchema,
  wallpaperSelectionSchema,
  type ThemeVariantPatch,
  themeVariants,
  THEME_ARCHIVE_LIMIT,
  type ThemeDocument,
  type ThemeBundle,
  type ThemeArchive,
  type PaletteDocument,
  type AssetId,
} from '@workspace/contracts'
import { BUNDLED_THEMES } from '@workspace/contracts'
import { themeErrors } from './structured-errors'
import type { PaletteLibrary } from './palette-library'
import type { WallpaperLibrary } from './wallpapers/library'
import type { SettingsStore } from '../settings/store'
import { decodeWallpaper } from './wallpapers/decode'

export class BundleLibrary {
  readonly options: {
    directory: string
    palettes: PaletteLibrary
    wallpapers: WallpaperLibrary
    settings: Pick<SettingsStore, 'snapshot' | 'write'>
  }
  constructor(options: BundleLibrary['options']) {
    this.options = options
  }

  async directories(): Promise<string[]> {
    await mkdir(this.options.directory, { recursive: true })
    const entries = await readdir(this.options.directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && v.is(themeIdSchema, entry.name))
      .map((entry) => path.join(this.options.directory, entry.name))
  }

  async list(): Promise<ThemeBundle[]> {
    const themes = await Promise.all(
      (await this.directories()).map(async (directory) =>
        v.parse(
          themeBundleSchema,
          JSON.parse(await readFile(path.join(directory, 'theme.json'), 'utf8')),
        ),
      ),
    )
    return [...BUNDLED_THEMES, ...themes].sort((a, b) => a.name.localeCompare(b.name))
  }

  async assertPartUnused(kind: 'palette' | 'wallpaper', id: string) {
    const values = this.options.settings.snapshot().values
    const themes = [
      ...(await this.list()),
      ...(values['workbench.theme'] ? [values['workbench.theme']] : []),
    ]
    const variants = themes.flatMap((theme) => Object.values(theme.variants))
    const patches = Object.values(values['workbench.theme.customizations']).flatMap((theme) =>
      Object.values(theme),
    )
    const used = [...variants, ...patches].some((part) =>
      kind === 'palette'
        ? part?.palette === id
        : part?.wallpaper?.source.kind === 'library' && part.wallpaper.source.asset === id,
    )
    if (used)
      throw themeErrors.BUNDLE_INVALID({
        detail: `This ${kind} belongs to a theme. Change that theme’s parts before deleting it.`,
      })
  }

  async remove(input: string) {
    const id = v.parse(themeIdSchema, input)
    if (BUNDLED_THEMES.some((theme) => theme.id === id))
      throw themeErrors.BUNDLE_INVALID({ detail: 'Bundled themes cannot be deleted' })
    const selected = this.options.settings.snapshot().values['workbench.theme']
    const operations: import('@workspace/contracts').SettingsOperation[] = [
      { kind: 'theme.reset', id },
    ]
    if (selected?.id === id)
      operations.push({ kind: 'set', key: 'workbench.theme', value: BUNDLED_THEMES[0]! })
    const directory = path.join(this.options.directory, id)
    const ownedPalettes = await readdir(path.join(directory, 'palettes'))
    const ownedWallpapers = await readdir(path.join(directory, 'wallpapers'))
    const snapshot = this.options.settings.snapshot()
    const others = (await this.list()).filter((theme) => theme.id !== id)
    if (selected && selected.id !== id) others.push(selected)
    const references: ThemeVariantPatch[] = [
      ...others.flatMap((theme) => Object.values(theme.variants)),
      ...Object.entries(snapshot.values['workbench.theme.customizations'])
        .filter(([themeId]) => themeId !== id)
        .flatMap(([, modes]) => Object.values(modes)),
      ...snapshot.layers.map((layer) => {
        const wallpaper = v.safeParse(wallpaperSelectionSchema, layer.raw['workbench.wallpaper'])
        const palette = layer.raw['workbench.palette']
        return {
          ...(typeof palette === 'string' ? { palette } : {}),
          ...(wallpaper.success ? { wallpaper: wallpaper.output } : {}),
        }
      }),
    ]
    if (references.some((part) => usesOwnedPart(part, ownedPalettes, ownedWallpapers)))
      throw themeErrors.BUNDLE_INVALID({
        detail: 'Another theme or setting uses parts from this imported bundle',
      })
    await this.options.settings.write({
      mutationId: `theme-delete:${randomUUID()}`,
      target: 'user',
      operations,
    })
    await rm(directory, { recursive: true })
    return { deleted: id }
  }

  async create(input: unknown): Promise<ThemeBundle> {
    const document = parseDocument(input)
    await this.validateParts(document, [])
    return this.publish(document, [], null)
  }

  async importArchive(input: unknown): Promise<ThemeBundle> {
    const parsed = v.safeParse(themeArchiveSchema, input)
    if (!parsed.success) throw themeErrors.BUNDLE_INVALID({ detail: v.summarize(parsed.issues) })
    const archive = parsed.output
    if (Buffer.byteLength(JSON.stringify(archive)) > THEME_ARCHIVE_LIMIT)
      throw themeErrors.BUNDLE_INVALID({ detail: 'Archive exceeds 60 MiB' })
    const originals = archive.palettes.map(normalizePalette)
    const palettes = originals.map((palette) => ({
      ...palette,
      id: `import-${createHash('sha256').update(JSON.stringify(palette.variants)).digest('hex').slice(0, 32)}`,
    }))
    const remap = new Map(originals.map((palette, index) => [palette.id, palettes[index]!.id]))
    const variant = (part: ThemeDocument['variants']['light']) => ({
      ...part,
      palette: remap.get(part.palette) ?? part.palette,
    })
    const document = {
      ...archive.theme,
      variants: {
        light: variant(archive.theme.variants.light),
        dark: variant(archive.theme.variants.dark),
      },
    }
    await this.validateParts(
      document,
      palettes,
      archive.wallpapers.map((asset) => asset.id),
    )
    const existing = (await this.list()).find((theme) => theme.id === document.id)
    if (existing) document.id = v.parse(themeIdSchema, `import-${randomUUID()}`)
    return this.publish(document, palettes, archive)
  }

  async exportArchive(input: string): Promise<ThemeArchive> {
    const id = v.safeParse(themeIdSchema, input)
    const theme = (await this.list()).find((entry) => entry.id === id.output)
    if (!id.success || !theme) throw themeErrors.BUNDLE_INVALID({ detail: 'Theme does not exist' })
    const variants = themeVariants(
      theme,
      this.options.settings.snapshot().values['workbench.theme.customizations'],
    )
    const palettes = await Promise.all(
      [...new Set(Object.values(variants).map((part) => part.palette))]
        .filter((palette) => !bundledPalette(palette))
        .map((palette) => this.options.palettes.read(palette)),
    )
    const assets = new Set<AssetId>()
    for (const variant of Object.values(variants)) {
      if (variant.wallpaper.source.kind === 'library') assets.add(variant.wallpaper.source.asset)
    }
    const wallpapers = await Promise.all(
      [...assets].map(async (assetId) => {
        const asset = await this.options.wallpapers.read(assetId)
        const directory = await this.options.wallpapers.assetDirectory(assetId)
        return {
          id: assetId,
          name: asset.name,
          base64: (await readFile(path.join(directory, `${assetId}.${asset.extension}`))).toString(
            'base64',
          ),
        }
      }),
    )
    const notices =
      theme.source === 'user'
        ? v.parse(
            themeArchiveSchema.entries.notices,
            JSON.parse(
              await readFile(path.join(this.options.directory, theme.id, 'notices.json'), 'utf8'),
            ),
          )
        : []
    return {
      format: 'platform-theme',
      version: 1,
      theme: { schemaVersion: 1, id: theme.id, name: theme.name, variants },
      palettes,
      wallpapers,
      notices: notices.length
        ? notices
        : [
            'Wallpaper redistribution rights are unverified. Original artwork rights remain with its author.',
          ],
    }
  }

  private async validateParts(
    document: ThemeDocument,
    palettes: readonly PaletteDocument[],
    assets?: readonly AssetId[],
  ) {
    for (const mode of ['light', 'dark'] as const) {
      const variant = document.variants[mode]
      const bundled = bundledPalette(variant.palette)
      const candidate = palettes.find((palette) => palette.id === variant.palette)
      if (assets && !bundled && !candidate)
        throw themeErrors.BUNDLE_INVALID({ detail: 'Archive is missing a referenced palette' })
      const parsed = bundled
        ? null
        : parsePalette(candidate ?? (await this.options.palettes.read(variant.palette)), 'user')
      const palette = bundled ?? (parsed?.success ? parsed.palette : null)
      if (!palette || !paletteSupportsMode(palette, mode))
        throw themeErrors.BUNDLE_INVALID({ detail: `${variant.palette} does not support ${mode}` })
      const syntaxModes: Readonly<Record<string, string>> = SYNTAX_THEME_MODES
      const syntaxMode =
        syntaxModes[variant.codeTheme] ?? variant.codeTheme.replace('tree-sitter-', '')
      if (syntaxMode !== mode)
        throw themeErrors.BUNDLE_INVALID({
          detail: `Syntax theme ${variant.codeTheme} does not support ${mode}`,
        })
      const source = variant.wallpaper.source
      if (source.kind !== 'library') continue
      if (assets?.includes(source.asset)) continue
      if (assets)
        throw themeErrors.BUNDLE_INVALID({ detail: 'Archive is missing a referenced wallpaper' })
      await this.options.wallpapers.read(source.asset)
    }
  }

  private async publish(
    document: ThemeDocument,
    palettes: readonly PaletteDocument[],
    archive: ThemeArchive | null,
  ) {
    if (BUNDLED_THEMES.some((theme) => theme.id === document.id))
      throw themeErrors.BUNDLE_INVALID({ detail: 'Use a new id for a bundled theme copy' })
    await mkdir(this.options.directory, { recursive: true })
    const stage = path.join(this.options.directory, `.import-${randomUUID()}`)
    await mkdir(stage)
    try {
      await mkdir(path.join(stage, 'palettes'))
      await mkdir(path.join(stage, 'wallpapers'))
      for (const palette of palettes)
        await writeFile(path.join(stage, 'palettes', `${palette.id}.json`), JSON.stringify(palette))
      for (const asset of archive?.wallpapers ?? []) await stageWallpaper(stage, asset)
      const theme: ThemeBundle = {
        ...document,
        source: 'user',
        revision: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
      }
      await writeFile(path.join(stage, 'theme.json'), JSON.stringify(theme, null, 2))
      await writeFile(path.join(stage, 'notices.json'), JSON.stringify(archive?.notices ?? []))
      await rename(stage, path.join(this.options.directory, document.id))
      return theme
    } catch (cause) {
      await rm(stage, { recursive: true, force: true })
      throw themeErrors.BUNDLE_INVALID({
        detail: cause instanceof Error ? cause.message : 'Import failed',
      })
    }
  }
}

async function stageWallpaper(stage: string, asset: ThemeArchive['wallpapers'][number]) {
  const bytes = Buffer.from(asset.base64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== asset.id)
    throw themeErrors.BUNDLE_INVALID({ detail: 'Wallpaper hash does not match' })
  const { thumbnail, display, ...metadata } = await decodeWallpaper(bytes)
  const directory = path.join(stage, 'wallpapers')
  await writeFile(path.join(directory, `${asset.id}.${metadata.extension}`), bytes)
  await writeFile(path.join(directory, `${asset.id}.thumb.webp`), thumbnail)
  await writeFile(path.join(directory, `${asset.id}.display.webp`), display)
  await writeFile(
    path.join(directory, `${asset.id}.json`),
    JSON.stringify({
      ...metadata,
      id: asset.id,
      name: asset.name,
      thumbnail: `${asset.id}.thumb.webp`,
      provenance: [{ kind: 'upload' }],
      redistribution: 'unverified',
    }),
  )
}

function parseDocument(input: unknown): ThemeDocument {
  const result = v.safeParse(themeDocumentSchema, input)
  if (!result.success) throw themeErrors.BUNDLE_INVALID({ detail: v.summarize(result.issues) })
  return result.output
}
function normalizePalette(input: unknown): PaletteDocument {
  const result = parsePalette(input, 'user')
  if (!result.success) throw themeErrors.BUNDLE_INVALID({ detail: 'Invalid palette in archive' })
  if (bundledPalette(result.palette.id))
    throw themeErrors.BUNDLE_INVALID({ detail: 'Archive may not replace bundled palettes' })
  return serializePalette(result.palette)
}

function usesOwnedPart(
  part: ThemeVariantPatch,
  palettes: readonly string[],
  wallpapers: readonly string[],
) {
  if (part.palette && palettes.includes(`${part.palette}.json`)) return true
  const source = part.wallpaper?.source
  return source?.kind === 'library' && wallpapers.includes(`${source.asset}.json`)
}
