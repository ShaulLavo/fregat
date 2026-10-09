import {
  APPEARANCE_BOOT_KEYS,
  bundledPalette,
  parsePalette,
  resolveThemeSettings,
  variantFromSettings,
  type AppearanceBootValues,
  type AppearanceBootstrapVariant,
  type ColorMode,
  type EnvironmentId,
  type HtmlBootstrap,
  type Palette,
  type SettingsSnapshot,
  type SettingsValues,
} from '@workspace/contracts'
import { paletteStylesheet } from '@workspace/contracts/themes/palette-rendering'
import type { PaletteLibrary } from '../themes/palette-library'
import { webErrors } from './structured-errors'

export type AppearanceBootstrap = Readonly<{ payload: HtmlBootstrap; paletteCSS: string }>
type Backdrop = Extract<HtmlBootstrap, { kind: 'app' }>['backdrop']

export async function createAppearanceBootstrap({
  snapshot,
  environmentId,
  apiBase,
  backdrop,
  palettes,
}: {
  readonly snapshot: SettingsSnapshot
  readonly environmentId: EnvironmentId
  readonly apiBase: string
  readonly backdrop: Backdrop
  readonly palettes: Pick<PaletteLibrary, 'read'>
}): Promise<AppearanceBootstrap> {
  const light = resolveMode(snapshot, 'light')
  const dark = resolveMode(snapshot, 'dark')
  const theme = snapshot.values['workbench.theme']
  const normalizedTheme = theme
    ? {
        ...theme,
        variants: {
          light: variantFromSettings(light, 'light'),
          dark: variantFromSettings(dark, 'dark'),
        },
      }
    : null
  const normalized = (values: SettingsValues): AppearanceBootValues =>
    pickValues({
      ...values,
      'workbench.colorTheme': snapshot.values['workbench.colorTheme'],
      'workbench.theme': normalizedTheme,
      'workbench.theme.customizations': {},
    })
  const lightPalette = await selectedPalette(light['workbench.palette'], palettes)
  const darkPalette =
    dark['workbench.palette'] === lightPalette.id
      ? lightPalette
      : await selectedPalette(dark['workbench.palette'], palettes)
  const variants = {
    light: appearanceVariant(normalized(light), lightPalette, apiBase, backdrop),
    dark: appearanceVariant(normalized(dark), darkPalette, apiBase, backdrop),
  }
  return {
    payload: {
      version: 1,
      kind: 'app',
      environmentId,
      apiBase,
      serverVersion: snapshot.serverVersion,
      backdrop,
      colorMode: snapshot.values['workbench.colorTheme'],
      variants,
    },
    paletteCSS: paletteStylesheet(lightPalette, darkPalette),
  }
}

function resolveMode(snapshot: SettingsSnapshot, mode: ColorMode) {
  return resolveThemeSettings(
    { ...snapshot.values, 'workbench.colorTheme': mode },
    mode,
    snapshot.layers,
  )
}

function pickValues(values: SettingsValues): AppearanceBootValues {
  return Object.fromEntries(
    APPEARANCE_BOOT_KEYS.map((key) => [key, values[key]]),
  ) as AppearanceBootValues
}

async function selectedPalette(
  id: string,
  palettes: Pick<PaletteLibrary, 'read'>,
): Promise<Palette> {
  const bundled = bundledPalette(id)
  if (bundled) return bundled
  const result = parsePalette(await palettes.read(id), 'user')
  if (!result.success)
    throw webErrors.BOOTSTRAP_INVALID({
      internal: { stage: 'palette', issueCount: result.issues.length },
    })
  return result.palette
}

function appearanceVariant(
  values: AppearanceBootValues,
  palette: Palette,
  apiBase: string,
  backdrop: Backdrop,
): AppearanceBootstrapVariant {
  const wallpaper = values['workbench.wallpaper']
  if (!wallpaper.enabled || backdrop === 'transparent') return { values, palette, image: null }
  const source = wallpaper.source
  if (source.kind === 'desktop' && backdrop === 'compositor')
    return { values, palette, image: null }
  const path =
    source.kind === 'desktop' ? 'wallpaper/still' : `themes/wallpapers/${source.asset}/display`
  return {
    values,
    palette,
    image: {
      href: new URL(path, `${apiBase.replace(/\/+$/u, '')}/`).href,
      crossOrigin: 'anonymous',
    },
  }
}

/** Native hosts append a window-specific hint; ordinary browsers report their viewing platform. */
export function documentBackdrop(headers: Headers): Backdrop {
  const agent = headers.get('user-agent') ?? ''
  const native = /(?:^|\s)FregatBackdrop\/(app|compositor|transparent)(?:\s|$)/u.exec(agent)?.[1]
  if (native === 'transparent' || native === 'compositor' || native === 'app') return native
  const hint = headers.get('sec-ch-ua-platform')?.replaceAll('"', '')
  if (hint === 'Linux') return 'compositor'
  if (hint === 'macOS' || hint === 'Windows' || /android|iphone|ipad/iu.test(agent)) return 'app'
  return /linux|bsd/iu.test(agent) ? 'compositor' : 'app'
}
