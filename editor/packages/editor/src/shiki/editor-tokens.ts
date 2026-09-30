import type { EditorToken, EditorTokenStyle } from '../tokens'
import {
  createPackedEditorTokenWriter,
  finishPackedEditorTokenWriter,
  writePackedEditorToken,
  type PackedEditorTokens,
  type PackedEditorTokenWriter,
} from '../syntax/packedTokens'

import type { IncrementalTokenizerSnapshot, TokenLineSnapshot } from './tokenizer'

const FONT_STYLE_ITALIC = 1
const FONT_STYLE_BOLD = 2
const FONT_STYLE_UNDERLINE = 4
const FONT_STYLE_STRIKETHROUGH = 8
const EDITOR_FONT_STYLE_MASK =
  FONT_STYLE_ITALIC | FONT_STYLE_BOLD | FONT_STYLE_UNDERLINE | FONT_STYLE_STRIKETHROUGH

type ShikiToken = TokenLineSnapshot['tokens'][number]

type InternedEditorTokenStyle = {
  readonly id: number
  readonly style: EditorTokenStyle
}

type EditorTokenStylePalette = {
  readonly entriesByKey: Map<string, InternedEditorTokenStyle | null>
  readonly styles: EditorTokenStyle[]
}

function toEditorTokenStyle(token: ShikiToken): EditorTokenStyle | null {
  const style: EditorTokenStyle = {}
  const fontStyle = token.fontStyle ?? 0

  if (token.color) style.color = token.color

  if (token.bgColor) style.backgroundColor = token.bgColor

  if (fontStyle & FONT_STYLE_ITALIC) style.fontStyle = 'italic'

  if (fontStyle & FONT_STYLE_BOLD) style.fontWeight = 700

  const textDecorations: string[] = []
  if (fontStyle & FONT_STYLE_UNDERLINE) textDecorations.push('underline')
  if (fontStyle & FONT_STYLE_STRIKETHROUGH) textDecorations.push('line-through')
  if (textDecorations.length > 0) style.textDecoration = textDecorations.join(' ')

  return Object.keys(style).length > 0 ? style : null
}

function createEditorTokenStylePalette(): EditorTokenStylePalette {
  return { entriesByKey: new Map(), styles: [] }
}

function internEditorTokenStyle(
  token: ShikiToken,
  palette: EditorTokenStylePalette,
): InternedEditorTokenStyle | null {
  const key = editorTokenStyleKey(token)
  const existing = palette.entriesByKey.get(key)
  if (existing !== undefined) return existing

  const style = toEditorTokenStyle(token)
  if (!style) {
    palette.entriesByKey.set(key, null)
    return null
  }

  const entry = { id: palette.styles.length, style }
  palette.entriesByKey.set(key, entry)
  palette.styles.push(style)
  return entry
}

function editorTokenStyleKey(token: ShikiToken): string {
  const fontStyle = (token.fontStyle ?? 0) & EDITOR_FONT_STYLE_MASK
  return `${token.color ?? ''}\u0000${token.bgColor ?? ''}\u0000${fontStyle}`
}

function hasEditorTokenStyle(token: ShikiToken): boolean {
  if (token.color) return true
  if (token.bgColor) return true
  return Boolean((token.fontStyle ?? 0) & EDITOR_FONT_STYLE_MASK)
}

export function tokenLinesToEditorTokens(lines: readonly TokenLineSnapshot[]): EditorToken[] {
  const tokens: EditorToken[] = []
  const palette = createEditorTokenStylePalette()
  let lineStart = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (!line) continue

    appendEditorTokensFromLine(tokens, line, lineStart, palette)
    lineStart = nextLineStart(lineStart, line.text.length, lineIndex, lines.length)
  }

  return tokens
}

function appendEditorTokensFromLine(
  tokens: EditorToken[],
  line: TokenLineSnapshot,
  lineStart: number,
  palette: EditorTokenStylePalette,
): void {
  for (const token of line.tokens) {
    if (token.content.length === 0) continue

    const entry = internEditorTokenStyle(token, palette)
    if (!entry) continue

    const start = lineStart + token.offset
    tokens.push({ end: start + token.content.length, start, style: entry.style })
  }
}

function nextLineStart(
  lineStart: number,
  lineLength: number,
  lineIndex: number,
  lineCount: number,
): number {
  return lineStart + lineLength + (lineIndex < lineCount - 1 ? 1 : 0)
}

export function snapshotToEditorTokens(
  snapshot: Pick<IncrementalTokenizerSnapshot, 'lines'>,
): EditorToken[] {
  return tokenLinesToEditorTokens(snapshot.lines)
}

export function snapshotToPackedEditorTokens(
  snapshot: Pick<IncrementalTokenizerSnapshot, 'lines'>,
): PackedEditorTokens {
  return packTokenLines(snapshot.lines, 0)
}

/** The tokens of `lines` at document offsets, the first line starting at `fromOffset`. */
export function packTokenLines(
  lines: readonly TokenLineSnapshot[],
  fromOffset: number,
): PackedEditorTokens {
  const writer = createPackedEditorTokenWriter(countEditorTokens(lines))
  const palette = createEditorTokenStylePalette()
  let lineStart = fromOffset

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line) continue

    writePackedTokenLine(writer, palette, line, lineStart)
    lineStart = nextLineStart(lineStart, line.text.length, lineIndex, lines.length)
  }

  return finishPackedEditorTokenWriter(writer, palette.styles)
}

function countEditorTokens(lines: readonly TokenLineSnapshot[]): number {
  let count = 0
  for (const line of lines) count += countEditorTokensInLine(line)
  return count
}

function countEditorTokensInLine(line: TokenLineSnapshot): number {
  let count = 0
  for (const token of line.tokens) {
    if (token.content.length === 0) continue
    if (!hasEditorTokenStyle(token)) continue
    count += 1
  }
  return count
}

function writePackedTokenLine(
  writer: PackedEditorTokenWriter,
  palette: EditorTokenStylePalette,
  line: TokenLineSnapshot,
  lineStart: number,
): void {
  for (const token of line.tokens) {
    if (token.content.length === 0) continue

    const entry = internEditorTokenStyle(token, palette)
    if (!entry) continue

    const start = lineStart + token.offset
    writePackedEditorToken(writer, start, start + token.content.length, entry.id)
  }
}
