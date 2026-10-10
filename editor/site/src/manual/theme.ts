import type { EditorTheme } from '@singapore-editor/core/rendering'
const SYNTAX_COLORS = {
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

type SyntaxColorId = keyof typeof SYNTAX_COLORS

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
