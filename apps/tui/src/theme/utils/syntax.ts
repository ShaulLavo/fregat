import { editorThemeFromVscodeTheme, type VscodeThemeRegistration } from '@singapor/core/shiki'
import {
  SyntaxStyle,
  type ThemeTokenStyle,
  type TextareaRenderable,
  type Highlight,
} from '@opentui/core'

import { colorForTerminal } from '@/theme/utils/colors'
import type { Theme } from '@/theme/utils/theme'

export function createSyntaxStyle(
  registration: VscodeThemeRegistration,
  theme: Pick<Theme, 'colorMode' | 'terminalColors'>,
) {
  const extracted = editorThemeFromVscodeTheme(registration)
  const convert = (color: string) => colorForTerminal(color, theme.colorMode, theme.terminalColors)
  const styles: ThemeTokenStyle[] = Object.entries(extracted.syntax ?? {}).map(
    ([scope, color]) => ({
      scope: [scope.replace(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`)],
      style: { foreground: convert(color) },
    }),
  )
  if (extracted.foregroundColor)
    styles.push({ scope: ['default'], style: { foreground: convert(extracted.foregroundColor) } })
  return SyntaxStyle.fromTheme(styles)
}

function jsonHighlights(text: string, syntax: SyntaxStyle, tabWidth = 4) {
  const highlights: Highlight[] = []
  let cursor = 0
  let position = 0
  for (const match of text.matchAll(
    /"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )) {
    position += highlightWidth(text.slice(cursor, match.index), tabWidth)
    const end = position + highlightWidth(match[0], tabWidth)
    const scope = jsonTokenScope(match[0], text.slice(match.index + match[0].length))
    const styleId = syntax.getStyleId(scope) ?? syntax.getStyleId('default') ?? 0
    highlights.push({ start: position, end, styleId })
    cursor = match.index + match[0].length
    position = end
  }
  return highlights
}

export function applyJsonHighlights(input: TextareaRenderable, syntax: SyntaxStyle) {
  input.syntaxStyle = syntax
  input.clearAllHighlights()
  for (const highlight of jsonHighlights(input.plainText, syntax, input.editBuffer.getTabWidth()))
    input.addHighlightByCharRange(highlight)
}

function highlightWidth(text: string, tabWidth: number) {
  // Native highlight ranges count display cells, excluding newlines.
  return Bun.stringWidth(text.replaceAll('\t', ' '.repeat(tabWidth)))
}

function jsonTokenScope(token: string, remaining: string) {
  if (token.startsWith('"')) return /^\s*:/.test(remaining) ? 'property' : 'string'
  if (/^-?\d/.test(token)) return 'number'
  return 'constant'
}
