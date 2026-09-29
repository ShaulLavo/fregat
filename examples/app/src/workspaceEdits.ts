import type { TextReadSnapshot } from '@singapore-editor/core/document'

type Position = { readonly line: number; readonly character: number }

export type LspTextEdit = {
  readonly range: { readonly start: Position; readonly end: Position }
  readonly newText: string
}

export type OffsetEdit = { readonly from: number; readonly to: number; readonly text: string }

/** Offsets in the editor's current text; the editor applies a batch against the text before it. */
export function offsetEdits(
  snapshot: TextReadSnapshot,
  edits: readonly LspTextEdit[],
): OffsetEdit[] {
  return edits.map((edit) => ({
    from: snapshotOffset(snapshot, edit.range.start),
    to: snapshotOffset(snapshot, edit.range.end),
    text: edit.newText,
  }))
}

/**
 * The same edits against a file that is not open, all measured against its text before them.
 * Applied from the back; inserts at one offset go in reverse, so they land in array order.
 */
export function applyTextEdits(text: string, edits: readonly LspTextEdit[]): string {
  const lineStarts = textLineStarts(text)
  const ordered = edits
    .map((edit, index) => ({
      index,
      from: textOffset(text, lineStarts, edit.range.start),
      to: textOffset(text, lineStarts, edit.range.end),
      text: edit.newText,
    }))
    .toSorted((left, right) => right.from - left.from || right.index - left.index)
  let result = text
  for (const edit of ordered) {
    result = `${result.slice(0, edit.from)}${edit.text}${result.slice(edit.to)}`
  }
  return result
}

function snapshotOffset(snapshot: TextReadSnapshot, position: Position): number {
  if (position.line >= snapshot.lineCount) return snapshot.length
  const line = snapshot.lineRange(position.line)
  return Math.min(line.start + position.character, line.end)
}

function textLineStarts(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

function textOffset(text: string, lineStarts: readonly number[], position: Position): number {
  const start = lineStarts[position.line]
  if (start === undefined) return text.length
  const next = lineStarts[position.line + 1]
  const end = next === undefined ? text.length : next - 1
  return Math.min(start + position.character, end)
}
