/**
 * Font references: `<source>:<id>`, the one value format for every font setting.
 *
 * Pure and schema-free, because the pre-paint boot script inlines it to start the chosen faces
 * before the bundle arrives.
 */

export const FONT_SOURCES = ['bundled', 'nerd', 'fontsource', 'local'] as const

export type FontSource = (typeof FONT_SOURCES)[number]

export type FontRef = { readonly source: FontSource; readonly id: string }

export type FontRole = 'ui' | 'code'

/** Shipped in the web bundle by `@fontsource-variable/*`, so they render with no network. */
export const BUNDLED_FONTS = {
  inter: { family: 'Inter Variable', label: 'Inter' },
  'jetbrains-mono': { family: 'JetBrains Mono Variable', label: 'JetBrains Mono' },
} as const

export type BundledFontId = keyof typeof BUNDLED_FONTS

/** Every code font falls back to it, so terminal prompt glyphs survive a font without them. */
export const NERD_SYMBOLS_FONT = 'nerd:NerdFontsSymbolsOnly'

const NERD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const FONTSOURCE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u
// A typed family lands inside a quoted CSS string, so nothing that could close it.
const LOCAL_FAMILY = /^[^"'\\;{}<>\r\n]{1,64}$/u
// Generic families are keywords, which a quoted name would turn into a font nobody has.
const GENERIC_FAMILIES = new Set([
  'monospace',
  'sans-serif',
  'serif',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
])

export function parseFontRef(value: string): FontRef | null {
  const separator = value.indexOf(':')
  if (separator < 1) return null

  const source = FONT_SOURCES.find((candidate) => candidate === value.slice(0, separator))
  const id = value.slice(separator + 1)
  if (!source || !isFontId(source, id)) return null

  return { source, id }
}

export function formatFontRef(ref: FontRef): string {
  return `${ref.source}:${ref.id}`
}

function isFontId(source: FontSource, id: string) {
  if (source === 'bundled') return Object.hasOwn(BUNDLED_FONTS, id)
  if (source === 'nerd') return NERD_ID.test(id)
  if (source === 'fontsource') return FONTSOURCE_ID.test(id)

  return LOCAL_FAMILY.test(id) && id.trim() === id
}

/**
 * The family a reference renders under. Derived from the id, never from a catalog display name,
 * because boot has no catalog: the boot script, the client loader and the server stylesheet
 * all name a face with this one function.
 */
export function fontFamilyName(ref: FontRef): string {
  if (ref.source === 'bundled') return BUNDLED_FONTS[ref.id as BundledFontId].family
  if (ref.source === 'nerd') return `${ref.id} Nerd Font`
  if (ref.source === 'fontsource') return `${ref.id} Fontsource`

  return ref.id
}

/** One entry of a CSS `font-family` list: quoted, except for generic keywords. */
export function cssFamily(family: string): string {
  return GENERIC_FAMILIES.has(family) ? family : JSON.stringify(family)
}
