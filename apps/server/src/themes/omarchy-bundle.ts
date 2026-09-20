import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import {
  BUNDLED_THEMES,
  bundledWallpaperFor,
  themeArchiveSchema,
  themeIdSchema,
  type ThemeArchive,
  type ThemeVariant,
} from '@workspace/contracts'
import { mapOmarchyPalette } from './omarchy-palette'
import { OMARCHY_THEMES_DIRECTORY } from './wallpapers/library'
import { MAX_WALLPAPER_BYTES } from './wallpapers/decode'
import { themeErrors } from './structured-errors'

const omarchyBundleNameSchema = v.picklist(['tokyo-night', 'rose-pine', 'catppuccin', 'gruvbox'])
export async function omarchyBundleArchive(input: unknown) {
  const parsed = v.safeParse(omarchyBundleNameSchema, input)
  if (!parsed.success)
    throw themeErrors.BUNDLE_INVALID({
      detail: 'Choose Tokyo Night, Rosé Pine, Catppuccin or Gruvbox',
    })
  const base = BUNDLED_THEMES.find((theme) => theme.id === parsed.output)!
  const report: string[] = []
  const palettes: ThemeArchive['palettes'] = []
  const wallpapers: ThemeArchive['wallpapers'] = []
  const variant = async (part: ThemeVariant, mode: 'light' | 'dark'): Promise<ThemeVariant> => {
    const artwork = await pairedWallpaper(part)
    if (artwork) wallpapers.push(artwork)
    // Hashed from the bytes read now, so an Omarchy update still yields a consistent archive.
    const wallpaper: ThemeVariant['wallpaper'] = artwork
      ? { enabled: true, source: { kind: 'library', asset: artwork.id } }
      : { enabled: false, source: { kind: 'desktop' } }
    if (!part.palette.startsWith('omarchy-')) {
      report.push(
        `${mode}: bundled ${part.palette} app colors; ${part.codeTheme} syntax. No installed Omarchy palette for this mode.`,
      )
      return { ...part, wallpaper }
    }
    const sourceName = part.palette.slice('omarchy-'.length)
    const directory = path.join(OMARCHY_THEMES_DIRECTORY, sourceName)
    const table = v.parse(
      v.record(v.string(), v.unknown()),
      Bun.TOML.parse(await readFile(path.join(directory, 'colors.toml'), 'utf8')),
    )
    const mapped = mapOmarchyPalette({
      table,
      id: `user-${part.palette}`,
      name: `${base.name} ${mode}`,
      themeName: sourceName,
      commit: (
        await readFile(path.join(OMARCHY_THEMES_DIRECTORY, '..', 'version'), 'utf8').catch(
          () => 'unknown',
        )
      ).trim(),
      repository: 'https://github.com/omacom/omarchy',
    })
    palettes.push(mapped.document)
    report.push(...mapped.report.map((line) => `${mode}: ${line}`))
    return { ...part, palette: mapped.document.id, wallpaper }
  }
  const light = await variant(base.variants.light, 'light')
  const dark = await variant(base.variants.dark, 'dark')
  const archive = v.parse(themeArchiveSchema, {
    format: 'platform-theme',
    version: 1,
    theme: {
      schemaVersion: 1,
      id: v.parse(themeIdSchema, `omarchy-${parsed.output}`),
      name: `${base.name} · Omarchy`,
      variants: { light, dark },
    },
    palettes,
    wallpapers,
    notices: ['Artwork redistribution rights are unverified.', report.join('\n')],
  })
  return { archive, report }
}

// The bundled variant already names its Omarchy wallpaper; the archive just carries the bytes.
async function pairedWallpaper(
  part: ThemeVariant,
): Promise<ThemeArchive['wallpapers'][number] | null> {
  if (part.wallpaper.source.kind !== 'library') return null
  const paired = bundledWallpaperFor(part.wallpaper.source.asset)
  if (!paired) return null
  const file = path.join(OMARCHY_THEMES_DIRECTORY, paired.theme, 'backgrounds', paired.file)
  const size = await stat(file).then(
    (entry) => entry.size,
    () => null,
  )
  if (size === null) return null
  if (size > MAX_WALLPAPER_BYTES)
    throw themeErrors.BUNDLE_INVALID({ detail: 'Omarchy wallpaper exceeds 20 MiB' })
  const bytes = await readFile(file)
  return {
    id: v.parse(
      themeArchiveSchema.entries.wallpapers.item.entries.id,
      createHash('sha256').update(bytes).digest('hex'),
    ),
    name: paired.file,
    base64: bytes.toString('base64'),
  }
}
