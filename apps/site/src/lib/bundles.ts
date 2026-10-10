import {
  BUNDLED_THEMES,
  bundledPalette,
  paletteColorsFor,
  toCss,
  type PaletteColors,
  type ThemeBundle,
} from '@workspace/contracts'
import type { ImageMetadata } from 'astro'
import { getImage } from 'astro:assets'
import sharp from 'sharp'
import { createScriptError } from '../../../../scripts/structured-errors'

// Every plate is painted from the app's own bundle data: its dark palette, its code theme,
// its wallpaper and its glass material. Plates stay dark in light mode, like the app's preview.
type CodeTheme = {
  readonly tokenColors?: readonly {
    readonly scope?: string | readonly string[]
    readonly settings: { readonly foreground?: string }
  }[]
  readonly colors?: Readonly<Record<string, string>>
}

const CODE_THEMES: Readonly<Record<string, () => Promise<{ default: CodeTheme }>>> = {
  'dark-plus': () => import('@shikijs/themes/dark-plus'),
  poimandres: () => import('@shikijs/themes/poimandres'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
  'rose-pine': () => import('@shikijs/themes/rose-pine'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
}

// Astro emits the original of every image module it sees, so the glob names only the dark
// wallpapers of the bundles the page shows. plateFor fails the build when one is missing.
// Astro's build-time image loader also supplies the original file for thumbnail generation.
type WallpaperAsset = ImageMetadata & { readonly fsPath: string }
const WALLPAPERS = import.meta.glob<WallpaperAsset>(
  [
    '../../../server/src/themes/wallpapers/assets/37746404*', // Tokyo Night
    '../../../server/src/themes/wallpapers/assets/06dfb9fc*', // Rosé Pine
    '../../../server/src/themes/wallpapers/assets/cdbd3cd7*', // Sage
    '../../../server/src/themes/wallpapers/assets/563190df*', // Catppuccin
    '../../../server/src/themes/wallpapers/assets/7e30d584*', // Graphite
  ],
  { import: 'default' },
)

const SYNTAX_SCOPES = {
  kw: ['keyword', 'storage.type', 'keyword.control', 'storage'],
  fn: ['entity.name.function', 'support.function'],
  str: ['string', 'string.quoted'],
  type: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class'],
  num: ['constant.numeric'],
  com: ['comment'],
} as const

export type Plate = {
  readonly name: string
  readonly style: string
  readonly wallpaper: string
  readonly wallpaperWidth: number
  readonly wallpaperHeight: number
}

export async function plateFor(id: string): Promise<Plate> {
  const bundle = BUNDLED_THEMES.find((candidate) => candidate.id === id)
  if (!bundle) throw createScriptError(`Unknown theme bundle "${id}"`)
  const variant = bundle.variants.dark
  const palette = bundledPalette(variant.palette)
  if (!palette) throw createScriptError(`Bundle "${id}" names a missing palette`)
  const colors = paletteColorsFor(palette, 'dark')
  const wallpaper = await wallpaperFor(bundle)
  const vars = {
    ...appVars(colors),
    ...(await syntaxVars(variant.codeTheme)),
    '--glass-opacity': `${variant.material.opacity}%`,
    '--glass-content-opacity': `${variant.material.contentOpacity}%`,
    '--glass-blur': `${variant.material.blur}px`,
    '--glass-saturation': `${variant.material.saturation}%`,
    '--wall': `url(data:image/webp;base64,${wallpaper.preview})`,
  }
  const style = Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
  return {
    name: bundle.name,
    style,
    wallpaper: wallpaper.image.src,
    wallpaperWidth: Number(wallpaper.image.attributes.width),
    wallpaperHeight: Number(wallpaper.image.attributes.height),
  }
}

function appVars(colors: PaletteColors): Record<string, string> {
  const { app, terminal } = colors
  return {
    '--bg': toCss(app.background),
    '--fg': toCss(app.foreground),
    '--card': toCss(app.card),
    '--muted': toCss(app.muted),
    '--mfg': toCss(app['muted-foreground']),
    '--primary': toCss(app.primary),
    '--pfg': toCss(app['primary-foreground']),
    '--success': toCss(app.success),
    '--warning': toCss(app.warning),
    '--info': toCss(app.info),
    '--danger': toCss(app.destructive),
    '--update': toCss(app.update),
    '--term-fg': toCss(terminal.foreground),
    '--t-green': toCss(terminal.green),
    '--t-blue': toCss(terminal.blue),
    '--t-yellow': toCss(terminal.yellow),
    '--t-cyan': toCss(terminal.cyan),
    '--t-mag': toCss(terminal.magenta),
    '--t-dim': toCss(terminal['bright-black']),
    '--t-red': toCss(terminal.red),
  }
}

async function syntaxVars(codeTheme: string): Promise<Record<string, string>> {
  const load = CODE_THEMES[codeTheme]
  if (!load) throw createScriptError(`Add code theme "${codeTheme}" to CODE_THEMES`)
  const theme = (await load()).default
  const fallback = theme.colors?.['editor.foreground'] ?? 'currentColor'
  return Object.fromEntries(
    Object.entries(SYNTAX_SCOPES).map(([role, scopes]) => [
      `--syn-${role}`,
      scopeColor(theme, scopes) ?? fallback,
    ]),
  )
}

function scopeColor(theme: CodeTheme, scopes: readonly string[]): string | undefined {
  for (const scope of scopes) {
    const rule = theme.tokenColors?.find(
      (candidate) => candidate.settings.foreground && ruleScopes(candidate.scope).includes(scope),
    )
    if (rule) return rule.settings.foreground
  }
  return undefined
}

function ruleScopes(scope: string | readonly string[] | undefined): readonly string[] {
  if (!scope) return []
  if (typeof scope !== 'string') return scope
  return scope.split(',').map((part) => part.trim())
}

async function wallpaperFor(bundle: ThemeBundle) {
  const source = bundle.variants.dark.wallpaper.source
  if (source.kind !== 'library')
    throw createScriptError(`Bundle "${bundle.id}" has no library wallpaper`)
  const file = Object.entries(WALLPAPERS).find(([path]) => path.includes(source.asset))
  if (!file) throw createScriptError(`Wallpaper ${source.asset} is missing from the server assets`)
  const metadata = await file[1]()
  if (!metadata.fsPath) throw createScriptError('Bundled wallpaper has no filesystem path')
  const image = await getImage({ src: metadata, width: 1680, format: 'webp', quality: 60 })
  // Inline a small first-paint wallpaper; the full image keeps native viewport-based loading.
  const preview = await sharp(metadata.fsPath)
    .resize({ width: 48 })
    .webp({ quality: 40 })
    .toBuffer()
  return { image, preview: preview.toString('base64') }
}
