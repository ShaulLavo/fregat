import type { EditorTheme } from '@singapore-editor/core/rendering'
/**
 * The docs palette is a set of `--sg-*` CSS variables (`manual.css`). Static pages colour tokens
 * with `s-*` classes and inline examples pass the same variables to Singapore's `Editor`, so both
 * read one table and a token cannot change colour at the swap.
 */
export const SYNTAX_COLORS = {
  attribute: 'prop',
  bracket: 'punct',
  comment: 'com',
  constant: 'num',
  function: 'fn',
  keyword: 'kw',
  // Markdown headings paint with this id (`text.title`), so it carries the heading colour.
  keywordDeclaration: 'title',
  keywordImport: 'kw',
  namespace: 'type',
  number: 'num',
  property: 'prop',
  string: 'str',
  textEmphasis: 'type',
  textStrong: 'num',
  type: 'type',
  typeDefinition: 'type',
  typeParameter: 'type',
  variable: 'fg',
  variableBuiltin: 'fg',
} as const

export type SyntaxColorId = keyof typeof SYNTAX_COLORS

const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** The `s-*` class a token painted with `var(--editor-syntax-<id>)` gets on a static page. */
export const syntaxClass = (id: SyntaxColorId) => `s-${kebab(id)}`

const SYNTAX_IDS = new Map(
  (Object.keys(SYNTAX_COLORS) as SyntaxColorId[]).map((id) => [`--editor-syntax-${kebab(id)}`, id]),
)

/** Reads the syntax id out of a token colour such as `var(--editor-syntax-keyword)`. */
export function syntaxIdForColor(color: string): SyntaxColorId | null {
  const variable = color.match(/^var\((--editor-syntax-[a-z-]+)\)$/)?.[1]
  return (variable && SYNTAX_IDS.get(variable)) || null
}

/** Rules that colour static tokens from the palette. */
export const syntaxStyles = (Object.entries(SYNTAX_COLORS) as [SyntaxColorId, string][])
  .map(([id, role]) => `.${syntaxClass(id)}{color:var(--sg-${role})}`)
  .join('')

/** Reads the page palette as resolved colours; `light-dark()` values resolve against the page. */
export function paletteTheme(host: HTMLElement, surface: 'bg' | 'code-bg'): EditorTheme {
  const probe = document.createElement('span')
  probe.hidden = true
  host.append(probe)
  const color = (role: string) => {
    probe.style.color = `var(--sg-${role})`
    return getComputedStyle(probe).color
  }
  const syntax = Object.fromEntries(
    (Object.entries(SYNTAX_COLORS) as [SyntaxColorId, string][]).map(([id, role]) => [
      id,
      color(role),
    ]),
  )
  const background = color('bg')
  const [red = 0, green = 0, blue = 0] = background.match(/[\d.]+/g)?.map(Number) ?? []
  const theme: EditorTheme = {
    type: 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128 ? 'dark' : 'light',
    backgroundColor: color(surface),
    foregroundColor: color('fg'),
    gutterBackgroundColor: color('bg'),
    gutterForegroundColor: color('gutter'),
    caretColor: color('caret'),
    selectionColor: color('selection'),
    popupBackgroundColor: color('bg'),
    syntax,
  }
  probe.remove()
  return theme
}
