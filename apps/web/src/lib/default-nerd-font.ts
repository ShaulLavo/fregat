import { queryOptions } from '@tanstack/react-query'
import { activeServerOrigin } from '@/lib/client'
import { appearanceKeys } from '@/lib/query-keys'

const DEFAULT_NERD_FONT_ID = 'JetBrainsMono'

/**
 * The family a fetched Nerd Font is registered under.
 *
 * Derived from the id rather than the vendor's display name (`JetBrainsMono` the
 * id ships as `JetBrains Mono Nerd Font`), because nothing maps between the two
 * and the id is the only name the client and server share. index.html registers
 * the same name before the bundle loads, so the two must change together.
 */
function nerdFontFamily(fontId: string): string {
  return `${fontId} Nerd Font`
}

export const DEFAULT_NERD_FONT_FAMILY = nerdFontFamily(DEFAULT_NERD_FONT_ID)

/**
 * The CSS stack for a font setting, which may be a Nerd Font id or a family the
 * user typed.
 *
 * Both cases fall out of the same two candidates. For a Nerd Font id the first
 * entry matches the face this module registers — deliberately named from the id,
 * because the id is the only name the client and server agree on (`JetBrainsMono`
 * the id is `JetBrains Mono Nerd Font` the family, and nothing maps between
 * them). For a family the user typed, the first entry simply does not match and
 * the second does, against whatever is installed locally.
 *
 * The generic fallbacks stay last so a font that will not download degrades to a
 * monospace face rather than to the browser's proportional default.
 */
export function fontStack(value: string): string {
  return `"${value} Nerd Font", "${value}", ui-monospace, SFMono-Regular, monospace`
}

/** Derived, not written out again: one definition of what a font stack is. */
export const DEFAULT_MONO_FONT_STACK = fontStack(DEFAULT_NERD_FONT_ID)

type FontSetTarget = Iterable<FontFace> & {
  add(fontFace: FontFace): unknown
  delete(fontFace: FontFace): unknown
}

type NerdFontEnvironment = {
  FontFace?: typeof FontFace | null
  fonts?: FontSetTarget | null
  url?: string
}

/**
 * The one owner of a Nerd Font download. Boot and the settings provider both ask for the
 * confirmed family; the key is what makes the second ask join the first.
 */
export function nerdFontQueryOptions(fontId: string, environment: NerdFontEnvironment = {}) {
  return queryOptions({
    queryKey: appearanceKeys.nerdFont(fontId),
    queryFn: () => registerNerdFont(fontId, environment),
    staleTime: 'static',
    gcTime: Infinity,
    // The browser may already hold the immutable font while offline.
    networkMode: 'always',
  })
}

/**
 * A URL source, not fetched bytes: the browser then owns the cache, a reload reuses the face
 * instead of re-parsing it, and `document.fonts.status` reports the wait to anything measuring.
 */
async function registerNerdFont(fontId: string, environment: NerdFontEnvironment) {
  const FontFaceClass = environment.FontFace ?? globalThis.FontFace
  const fonts = environment.fonts ?? documentFonts()
  if (!FontFaceClass || !fonts) return null

  const family = nerdFontFamily(fontId)
  // index.html starts this face before the bundle arrives; a second one would load it again.
  const started = registeredFace(fonts, family)
  if (started && started.status !== 'error') {
    await started.load()
    return family
  }
  if (started) fonts.delete(started)

  const source = `url(${JSON.stringify(environment.url ?? fontUrl(fontId))})`
  const face = new FontFaceClass(family, source, {
    display: 'swap',
    style: 'normal',
    weight: '400',
  })
  fonts.add(face)
  await face.load()
  return family
}

function registeredFace(fonts: FontSetTarget, family: string) {
  for (const face of fonts) {
    // Chrome serializes a family with spaces back in quotes.
    if (face.family.replaceAll('"', '') === family) return face
  }
  return null
}

function fontUrl(fontId: string) {
  const baseUrl = activeServerOrigin().endsWith('/')
    ? activeServerOrigin()
    : `${activeServerOrigin()}/`

  return new URL(`fonts/${encodeURIComponent(fontId)}`, baseUrl).href
}

export function fontPreviewUrl(fontId: string, text: string) {
  const baseUrl = activeServerOrigin().endsWith('/')
    ? activeServerOrigin()
    : `${activeServerOrigin()}/`
  const url = new URL(`fonts/${encodeURIComponent(fontId)}/preview`, baseUrl)
  url.searchParams.set('text', text)

  return url.href
}

function documentFonts() {
  if (typeof document === 'undefined') return null

  return document.fonts
}
