import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import {
  BUNDLED_THEMES,
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
    if (!part.palette.startsWith('omarchy-')) {
      report.push(
        `${mode}: Graphite app colors; ${part.codeTheme} syntax. No installed Omarchy palette for this mode.`,
      )
      return part
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
    const artwork = await firstWallpaper(directory)
    if (!artwork) return { ...part, palette: mapped.document.id }
    wallpapers.push(artwork)
    return {
      ...part,
      palette: mapped.document.id,
      wallpaper: { enabled: true, source: { kind: 'library', asset: artwork.id } },
    }
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

async function firstWallpaper(
  directory: string,
): Promise<ThemeArchive['wallpapers'][number] | null> {
  const folder = path.join(directory, 'backgrounds')
  const files = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const image = files
    .filter((file) => file.isFile() && /\.(png|jpe?g|webp)$/iu.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0]
  if (!image) return null
  const file = path.join(folder, image.name)
  if ((await stat(file)).size > MAX_WALLPAPER_BYTES)
    throw themeErrors.BUNDLE_INVALID({ detail: 'Omarchy wallpaper exceeds 20 MiB' })
  const bytes = await readFile(file)
  return {
    id: v.parse(
      themeArchiveSchema.entries.wallpapers.item.entries.id,
      createHash('sha256').update(bytes).digest('hex'),
    ),
    name: image.name,
    base64: bytes.toString('base64'),
  }
}
