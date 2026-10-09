import { NERD_SYMBOLS_FONT, cssFamily, fontFamilyName, parseFontRef } from '@workspace/contracts'

import { SHELL_CHUNKS_ID, developmentServerUrl } from '@/lib/boot-keys'
import { applyBackdrop, resolveBackdrop } from '@/lib/platform/backdrop'
import {
  bootstrapMode,
  initialAppearanceValues,
  readHtmlBootstrap,
  prepareWallpaperImage,
} from '@/lib/html-bootstrap'
import { COARSE_POINTER_QUERY, initialShellKind } from '@/lib/shell/utils/kind'
import { selectInitialAddress } from '@/features/address/state/storage'
import { phoneStartAddress, phoneBaseScreen } from '@/features/address/utils/phone-start'

// The pre-paint boot script. scripts/boot-appearance-plugin.ts bundles this into a classic
// inline script in index.html, because a module script would run after first paint.
// applyAppearance in main.tsx re-applies the full appearance once the app boots.

// Chromium exposes the keyboard API and supports this hint; WebKit warns when parsing it.
if ('virtualKeyboard' in navigator) {
  const viewport = document.querySelector('meta[name="viewport"]')
  if (viewport)
    viewport.setAttribute(
      'content',
      `${viewport.getAttribute('content')}, interactive-widget=resizes-content`,
    )
}

const values = initialAppearanceValues()
const appearance = {
  mode: bootstrapMode(values['workbench.colorTheme']),
  density: values['workbench.density'],
  feel: values['workbench.feel'],
  wallpaper: values['workbench.wallpaper'],
  uiFont: values['workbench.fontFamily'],
  codeFont: values['editor.fontFamily'],
}
const root = document.documentElement
const bootstrap = readHtmlBootstrap()
applyBackdrop(bootstrap?.kind === 'app' ? bootstrap.backdrop : resolveBackdrop())
root.classList.add(appearance.mode)
root.setAttribute('data-density', appearance.density)
root.setAttribute('data-feel', appearance.feel)
if (!appearance.wallpaper.enabled) root.setAttribute('data-wallpaper-hidden', '')
prepareWallpaperImage()
if (bootstrap?.kind === 'app') {
  startFont(appearance.uiFont)
  startFont(appearance.codeFont)
  if (parseFontRef(appearance.codeFont)?.source !== 'nerd') startFont(NERD_SYMBOLS_FONT)
}
// The shell is chosen before the first paint, so its chunks download beside the entry script.
const shell = initialShellKind((query) => window.matchMedia(query).matches)
root.setAttribute('data-shell', shell)
preloadShellChunks(shell)
if (shell === 'phone') {
  const href = phoneStartAddress(
    selectInitialAddress(location.href),
    selectInitialAddress(location.href, null),
    window.matchMedia(COARSE_POINTER_QUERY).matches,
  )
  preloadShellChunks(phoneBaseScreen(href))
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

// The build writes each shell's chunks and stylesheets into index.html (scripts/shell-chunks-plugin.ts); dev has none.
function preloadShellChunks(kind: 'phone' | 'workbench' | 'sessions' | 'session') {
  const manifest = document.getElementById(SHELL_CHUNKS_ID)?.textContent
  if (!manifest) return

  const chunks: unknown = (JSON.parse(manifest) as Record<string, unknown>)[kind]
  if (!Array.isArray(chunks)) return
  for (const href of chunks) {
    if (typeof href !== 'string') continue
    const link = document.createElement('link')
    // A stylesheet is only fetched here: the shell's dynamic import applies it and waits for it.
    const style = href.endsWith('.css')
    link.rel = style ? 'preload' : 'modulepreload'
    if (style) link.as = 'style'
    link.crossOrigin = ''
    link.href = href
    document.head.append(link)
  }
}
