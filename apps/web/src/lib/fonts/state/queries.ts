import { queryOptions } from '@tanstack/react-query'
import { cssFamily, fontFamilyName, parseFontRef } from '@workspace/contracts'

import { fontServerUrl } from '@/lib/fonts/utils/url'
import { appearanceKeys } from '@/lib/query-keys'
import { clientErrors } from '@/lib/structured-errors'

type FontSetTarget = Iterable<FontFace> & {
  add(fontFace: FontFace): unknown
  delete(fontFace: FontFace): unknown
  load(font: string): Promise<readonly FontFace[]>
}

type StylesheetHost = Pick<Document, 'createElement' | 'querySelector'> & {
  readonly head: Pick<HTMLElement, 'append'>
}

export type FontEnvironment = {
  FontFace?: typeof FontFace | null
  fonts?: FontSetTarget | null
  document?: StylesheetHost | null
  url?: (path: string) => string
}

/**
 * The one owner of a font download, for every source. Boot, the appearance provider and the
 * picker's hover preview all ask for a ref by this key, so a second ask joins the first.
 * Resolves to the family the face is registered under, or null where fonts cannot load.
 */
export function fontQueryOptions(value: string, environment: FontEnvironment = {}) {
  return queryOptions({
    queryKey: appearanceKeys.font(value),
    queryFn: () => loadFont(value, environment),
    staleTime: 'static',
    gcTime: Infinity,
    // The browser may already hold the immutable files while offline.
    networkMode: 'always',
  })
}

async function loadFont(value: string, environment: FontEnvironment) {
  const ref = parseFontRef(value)
  if (!ref) return null

  const family = fontFamilyName(ref)
  if (ref.source === 'nerd') return registerNerdFont(value, ref.id, family, environment)
  if (ref.source === 'fontsource') {
    const href = fontUrl(environment, `fonts/fontsource/${encodeURIComponent(ref.id)}.css`)
    return loadStylesheetFont(value, href, family, 'required', environment)
  }
  if (ref.source === 'local') {
    // The server serves its own installed copy; a family it lacks may be installed here.
    const href = fontUrl(environment, `fonts/local/${encodeURIComponent(ref.id)}.css`)
    return loadStylesheetFont(value, href, family, 'optional', environment)
  }

  // Bundled faces ship in the app's own stylesheet.
  return family
}

/**
 * A URL source, not fetched bytes: the browser then owns the cache, a reload reuses the face
 * instead of re-parsing it, and `document.fonts.status` reports the wait to anything measuring.
 */
async function registerNerdFont(
  value: string,
  id: string,
  family: string,
  environment: FontEnvironment,
) {
  const FontFaceClass = environment.FontFace ?? globalThis.FontFace
  const fonts = environment.fonts ?? documentFonts()
  if (!FontFaceClass || !fonts) return null

  // src/boot-appearance.ts starts this face before the bundle arrives; a second would load it again.
  const started = registeredFace(fonts, family)
  if (started && started.status !== 'error') {
    await loaded(started.load(), value, 'face')
    return family
  }
  if (started) fonts.delete(started)

  const url = fontUrl(environment, `fonts/nerd/${encodeURIComponent(id)}`)
  const face = new FontFaceClass(family, `url(${JSON.stringify(url)})`, {
    display: 'swap',
    style: 'normal',
    weight: '400',
  })
  fonts.add(face)
  await loaded(face.load(), value, 'face')
  return family
}

/** The server's stylesheet declares the faces; the browser fetches only the ones text uses. */
async function loadStylesheetFont(
  value: string,
  href: string,
  family: string,
  faces: 'required' | 'optional',
  environment: FontEnvironment,
) {
  const host = environment.document ?? globalDocument()
  const fonts = environment.fonts ?? documentFonts()
  if (!host || !fonts) return null

  await loaded(fontStylesheet(host, value, href), value, 'stylesheet')
  const loadedFaces = await loaded(fonts.load(`1em ${cssFamily(family)}`), value, 'faces')
  if (loadedFaces.length === 0 && faces === 'required') {
    throw clientErrors.FONT_LOAD_FAILED({ ref: value, internal: { stage: 'faces', faces: 0 } })
  }

  return family
}

/** Boot may have inserted the link already; `data-state` says how that went. */
function fontStylesheet(host: StylesheetHost, value: string, href: string) {
  const selector = `link[data-font-ref=${JSON.stringify(value)}]`
  const existing = host.querySelector<HTMLLinkElement>(selector)
  if (existing?.dataset.state === 'loaded') return Promise.resolve()
  if (existing?.dataset.state === 'pending') return settled(existing)
  existing?.remove()

  const link = host.createElement('link')
  link.rel = 'stylesheet'
  // CORS mode sends Origin, which the server's origin guard needs when the API is cross-origin.
  link.crossOrigin = 'anonymous'
  link.href = href
  link.dataset.fontRef = value
  link.dataset.state = 'pending'
  const done = settled(link)
  host.head.append(link)
  return done
}

function settled(link: HTMLLinkElement) {
  return new Promise<void>((resolve, reject) => {
    link.addEventListener(
      'load',
      () => {
        link.dataset.state = 'loaded'
        resolve()
      },
      { once: true },
    )
    link.addEventListener(
      'error',
      (event) => {
        link.dataset.state = 'error'
        reject(event)
      },
      { once: true },
    )
  })
}

function loaded<T>(pending: Promise<T>, value: string, stage: 'face' | 'stylesheet' | 'faces') {
  return pending.catch((cause: unknown) => {
    throw clientErrors.FONT_LOAD_FAILED({
      ref: value,
      cause: cause instanceof Error ? cause : undefined,
      internal: { stage },
    })
  })
}

function registeredFace(fonts: FontSetTarget, family: string) {
  for (const face of fonts) {
    // Chrome serializes a family with spaces back in quotes.
    if (face.family.replaceAll('"', '') === family) return face
  }
  return null
}

function fontUrl(environment: FontEnvironment, path: string) {
  return environment.url?.(path) ?? fontServerUrl(path).href
}

function documentFonts() {
  if (typeof document === 'undefined') return null

  return document.fonts
}

function globalDocument() {
  if (typeof document === 'undefined') return null

  return document
}
