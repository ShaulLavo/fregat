import {
  COLOR_THEME_MODES,
  DEFAULT_CODE_FONT,
  DEFAULT_COLOR_THEME,
  DEFAULT_PALETTE_ID,
  DEFAULT_WALLPAPER_SELECTION,
  DEFAULT_UI_FONT,
  DEFAULT_WORKBENCH_DENSITY,
  DEFAULT_WORKBENCH_FEEL,
  NERD_SYMBOLS_FONT,
  cssFamily,
  fontFamilyName,
  isWorkbenchDensity,
  isWorkbenchFeel,
  parseFontRef,
  type SettingsValues,
  type WallpaperSelection,
} from '@workspace/contracts'

import {
  BOOT_MIRROR_KEY,
  PALETTE_BOOT_KEY,
  PALETTE_STYLE_ID,
  developmentServerUrl,
  type BootWallpaperPreload,
} from '@/lib/boot-keys'
import { resolveBackdrop } from '@/lib/platform/backdrop'

// The pre-paint boot script. scripts/boot-appearance-plugin.ts bundles this into a classic
// inline script in index.html, because a module script would run after first paint.
// applyAppearance in main.tsx re-applies the full appearance once the app boots.

type StoredMirror = { readonly [K in keyof SettingsValues]?: unknown }

type BootAppearance = {
  mode: 'dark' | 'light'
  density: SettingsValues['workbench.density']
  feel: SettingsValues['workbench.feel']
  palette: string
  wallpaper: WallpaperSelection
  uiFont: string
  codeFont: string
}

const appearance = readBootAppearance()
const root = document.documentElement
root.classList.add(appearance.mode)
root.setAttribute('data-density', appearance.density)
root.setAttribute('data-feel', appearance.feel)
if (!appearance.wallpaper.enabled) root.setAttribute('data-wallpaper-hidden', '')
if (appearance.wallpaper.enabled && appearance.wallpaper.source.kind === 'desktop') {
  preloadDesktopWallpaper()
}
startFont(appearance.uiFont)
startFont(appearance.codeFont)
if (parseFontRef(appearance.codeFont)?.source !== 'nerd') startFont(NERD_SYMBOLS_FONT)
injectPaletteStylesheet(appearance.palette)

function readBootAppearance(): BootAppearance {
  const mirror = readStoredMirror()
  const mode = colorMode(mirror['workbench.colorTheme'])
  const density = mirror['workbench.density']
  const feel = mirror['workbench.feel']
  const uiFont = mirror['workbench.fontFamily']
  const codeFont = mirror['editor.fontFamily']
  const storedPalette = mirror['workbench.palette']
  const appearance: BootAppearance = {
    mode,
    density: isWorkbenchDensity(density) ? density : DEFAULT_WORKBENCH_DENSITY,
    feel: isWorkbenchFeel(feel) ? feel : DEFAULT_WORKBENCH_FEEL,
    palette: typeof storedPalette === 'string' ? storedPalette : DEFAULT_PALETTE_ID,
    wallpaper: DEFAULT_WALLPAPER_SELECTION,
    uiFont: typeof uiFont === 'string' ? uiFont : DEFAULT_UI_FONT,
    codeFont: typeof codeFont === 'string' ? codeFont : DEFAULT_CODE_FONT,
  }
  // The mirror is written from validated server snapshots, so its bundle shape is trusted here.
  const bundle = mirror['workbench.theme'] as SettingsValues['workbench.theme'] | undefined
  const variant = bundle?.variants[mode]
  if (!bundle || !variant) {
    const wallpaper = mirror['workbench.wallpaper'] as WallpaperSelection | undefined
    return wallpaper ? { ...appearance, wallpaper } : appearance
  }

  const customizations = mirror['workbench.theme.customizations'] as
    | SettingsValues['workbench.theme.customizations']
    | undefined
  const custom = customizations?.[bundle.id]?.[mode]
  return {
    ...appearance,
    palette: custom?.palette ?? variant.palette,
    wallpaper: custom?.wallpaper ?? variant.wallpaper,
  }
}

function colorMode(stored: unknown): 'dark' | 'light' {
  const theme = COLOR_THEME_MODES.find((mode) => mode === stored) ?? DEFAULT_COLOR_THEME
  if (theme !== 'system') return theme

  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredMirror(): StoredMirror {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BOOT_MIRROR_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // An unreadable mirror costs a default boot floor, nothing more.
    return {}
  }
}

// Mirrors defaultServerUrl in src/lib/client.ts: an explicit development override, else the
// page's own base URL, which is where one server serves both.
function serverBase(): string {
  const developmentServer = import.meta.env.DEV ? developmentServerUrl() : import.meta.env.BASE_URL
  const server = new URL(import.meta.env.VITE_SERVER_URL ?? developmentServer, location.href)
  return `${server.origin}${server.pathname.replace(/\/+$/, '')}`
}

// The editor measures its cell width as it mounts and the first frame sets words, so each face
// has to be in flight before the bundle is. src/lib/fonts/state/queries.ts adopts what starts here.
function startFont(value: string) {
  const ref = parseFontRef(value)
  if (ref?.source === 'nerd') startNerdFont(ref.id, fontFamilyName(ref))
  if (ref?.source === 'fontsource' || ref?.source === 'local') {
    const href = `${serverBase()}/fonts/${ref.source}/${encodeURIComponent(ref.id)}.css`
    startStylesheet(value, href, fontFamilyName(ref))
  }
}

function startNerdFont(id: string, family: string) {
  if (typeof FontFace === 'undefined') return

  const url = `${serverBase()}/fonts/nerd/${encodeURIComponent(id)}`
  const face = new FontFace(family, `url(${JSON.stringify(url)})`, {
    display: 'swap',
    style: 'normal',
    weight: '400',
  })
  document.fonts.add(face)
  // Offline and never cached: the stack falls through to the bundled face.
  face.load().catch(() => {})
}

// Render-blocking, so the first layout already knows the faces and fetches the subsets it sets.
function startStylesheet(value: string, href: string, family: string) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  // CORS mode sends Origin, which the server's origin guard needs when the API is cross-origin.
  link.crossOrigin = 'anonymous'
  link.href = href
  link.setAttribute('blocking', 'render')
  link.dataset.fontRef = value
  link.dataset.state = 'pending'
  link.onload = () => {
    link.dataset.state = 'loaded'
    document.fonts.load(`1em ${cssFamily(family)}`).catch(() => {})
  }
  link.onerror = () => {
    link.dataset.state = 'error'
  }
  document.head.append(link)
}

function preloadDesktopWallpaper() {
  // A compositor or a see-through window already shows the real desktop.
  if (resolveBackdrop() !== 'app') return

  const preload = document.createElement('link')
  preload.rel = 'preload'
  preload.as = 'image'
  preload.crossOrigin = 'anonymous'
  preload.href = `${serverBase()}/wallpaper/still`
  preload.fetchPriority = 'high'
  const record: BootWallpaperPreload = { href: preload.href, status: 'pending' }
  preload.onload = () => {
    record.status = 'ready'
  }
  preload.onerror = () => {
    record.status = 'error'
  }
  window.platformBootWallpaper = record
  document.head.append(preload)
}

// Before globals.css loads, so the first frame already carries the selected palette instead of
// flashing Graphite. Written by lib/appearance/utils/palette-style.ts for the confirmed selection.
function injectPaletteStylesheet(palette: string) {
  const css = readPaletteBootCache(palette)
  if (css === null) return

  const style = document.createElement('style')
  style.id = PALETTE_STYLE_ID
  style.textContent = css
  document.head.append(style)
}

function readPaletteBootCache(palette: string): string | null {
  try {
    const cache: unknown = JSON.parse(localStorage.getItem(PALETTE_BOOT_KEY) ?? 'null')
    if (!isPaletteBootCache(cache) || !cache.ids.includes(palette)) return null

    return cache.css
  } catch {
    return null
  }
}

function isPaletteBootCache(value: unknown): value is { ids: string[]; css: string } {
  if (!value || typeof value !== 'object') return false

  const { ids, css } = value as { ids?: unknown; css?: unknown }
  return Array.isArray(ids) && typeof css === 'string'
}
