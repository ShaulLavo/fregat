import type { EditorToken, EditorTokenStyle } from '../tokens'

// Structure-of-arrays token transport. Worker responses carry three numeric
// buffers plus a small style palette instead of one object per token, so
// postMessage transfers the buffers instead of structured-cloning hundreds of
// thousands of objects on the main thread.
export type PackedEditorTokens = {
  readonly starts: Uint32Array
  readonly ends: Uint32Array
  readonly styleIds: Uint32Array
  readonly styles: readonly EditorTokenStyle[]
  readonly monotonicEnd: boolean
  readonly nonOverlapping: boolean
  readonly sortedByStart: boolean
}

export type PackedEditorTokenWriter = {
  readonly ends: Uint32Array
  readonly starts: Uint32Array
  readonly styleIds: Uint32Array
  index: number
  maxEnd: number
  monotonicEnd: boolean
  nonOverlapping: boolean
  previousEnd: number
  previousStart: number
  sortedByStart: boolean
}

export function createPackedEditorTokenWriter(tokenCount: number): PackedEditorTokenWriter {
  return {
    ends: new Uint32Array(tokenCount),
    index: 0,
    maxEnd: 0,
    monotonicEnd: true,
    nonOverlapping: true,
    previousEnd: -Infinity,
    previousStart: -Infinity,
    sortedByStart: true,
    starts: new Uint32Array(tokenCount),
    styleIds: new Uint32Array(tokenCount),
  }
}

export function writePackedEditorToken(
  writer: PackedEditorTokenWriter,
  start: number,
  end: number,
  styleId: number,
): void {
  if (start < writer.previousStart) writer.sortedByStart = false
  if (start < writer.previousEnd) writer.nonOverlapping = false
  if (end < writer.maxEnd) writer.monotonicEnd = false

  writer.starts[writer.index] = start
  writer.ends[writer.index] = end
  writer.styleIds[writer.index] = styleId
  writer.index += 1
  writer.maxEnd = Math.max(writer.maxEnd, end)
  writer.previousEnd = end
  writer.previousStart = start
}

export function finishPackedEditorTokenWriter(
  writer: PackedEditorTokenWriter,
  styles: readonly EditorTokenStyle[],
): PackedEditorTokens {
  return {
    starts: writer.starts,
    ends: writer.ends,
    styleIds: writer.styleIds,
    styles,
    monotonicEnd: writer.monotonicEnd,
    nonOverlapping: writer.nonOverlapping,
    sortedByStart: writer.sortedByStart,
  }
}

export function packEditorTokens(tokens: readonly EditorToken[]): PackedEditorTokens {
  const writer = createPackedEditorTokenWriter(tokens.length)
  const styles: EditorTokenStyle[] = []
  // Styles come from shared per-capture tables, so identity de-duplication
  // collapses them into a small palette.
  const styleIdByStyle = new Map<EditorTokenStyle, number>()

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    let styleId = styleIdByStyle.get(token.style)
    if (styleId === undefined) {
      styleId = styles.length
      styles.push(token.style)
      styleIdByStyle.set(token.style, styleId)
    }
    writePackedEditorToken(writer, token.start, token.end, styleId)
  }

  return finishPackedEditorTokenWriter(writer, styles)
}

export function packedEditorTokenTransfers(packed: PackedEditorTokens): Transferable[] {
  return [packed.starts.buffer, packed.ends.buffer, packed.styleIds.buffer]
}

/** Object tokens for `[from, to)` of a packed answer; the whole-document form is for exports. */
export function unpackEditorTokens(
  packed: PackedEditorTokens,
  from = 0,
  to = packed.starts.length,
): EditorToken[] {
  const { starts, ends, styleIds, styles } = packed
  const tokens: EditorToken[] = []
  for (let index = Math.max(0, from); index < Math.min(to, starts.length); index += 1) {
    tokens.push({ start: starts[index]!, end: ends[index]!, style: styles[styleIds[index]!]! })
  }
  return tokens
}

/** Re-tokenized lines for text that replaced `[fromOffset, oldEndOffset)` with `[fromOffset, newEndOffset)`. */
export type PackedEditorTokenPatch = {
  readonly fromOffset: number
  readonly oldEndOffset: number
  readonly newEndOffset: number
  readonly tokensPacked: PackedEditorTokens
}
