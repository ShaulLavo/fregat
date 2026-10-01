import type { DiffRenderRow } from '@singapore-editor/diff'

export type DiffFilePosition = {
  /** Zero-based, as LSP counts. `DiffRenderRow.newLineNumber` is one-based. */
  readonly line: number
  readonly character: number
}

/** Which of the two texts a row stands for. Both are opened as documents, so both can be asked. */
export type DiffFileSide = 'new' | 'old'

/**
 * What a buffer offset turns out to be.
 *
 * Two answers rather than a position or null, deliberately. A feature handed `null` tends to fall
 * back to asking anyway; a feature handed a SIDE has to carry it through to the document it asks
 * about. That decision is the one both prior arts left implicit: VS Code has shipped an enabled,
 * permanently no-opping "Go to definition" on `git:` documents for nine years
 * (microsoft/vscode#324356), and Zed guards deleted-hunk positions in `completions.rs` and
 * `code_actions.rs` while missing hover and go-to-definition. Both enumerated call sites by hand.
 * This type is the chokepoint neither of them had.
 */
type DiffPositionLookup =
  /** A real line of one of the two texts, at this position in it. */
  | { readonly kind: 'file'; readonly side: DiffFileSide; readonly position: DiffFilePosition }
  /** Padding, a `Show N unmodified lines` label, or a row whose text the projection blanked. */
  | { readonly kind: 'none' }

export type DiffPositionMap = {
  lookupAt(offset: number): DiffPositionLookup
  /** Where a position in one of the two texts sits in the buffer, or null when it is not drawn. */
  bufferOffsetAt(side: DiffFileSide, position: DiffFilePosition): number | null
}

/**
 * Translates between the diff's buffer and the two texts it is drawing.
 *
 * The buffer a diff editor holds is its rows joined by LF — the two sides interleaved, plus
 * separator rows carrying a label and placeholder rows carrying nothing. So buffer line N is not
 * file line N, and anything position-based talking to a language server has to come through here.
 *
 * A row is resolved against the NEW text first and the old text second, so an unchanged line —
 * which carries both numbers — is answered about the file that still exists. Only a deletion ends
 * up on the old side.
 *
 * Three kinds of row stand for no line at all, and the third is the one worth naming:
 *
 * - placeholders, which pad the short side of a change block and stand for nothing;
 * - separators, whose text is the `Show N unmodified lines` label;
 * - a row whose text the projection BLANKED. `renderLineText` empties any line that looks like a
 *   raw hunk header, so a file that itself contains `@@ -1,2 +3,4 @@` projects an empty row while
 *   the file line has content. Its line number is honest and its columns are not.
 *
 * The third is caught by comparing each row against the line it claims, which also covers any
 * future divergence between projection and file without this needing to know about it. That check
 * needs the whole text; a partial diff carries none, and then nothing maps — which is correct,
 * because a patch-only diff is not the file.
 */
export function createDiffPositionMap(
  rows: readonly DiffRenderRow[],
  newLines: readonly string[],
  oldLines: readonly string[],
): DiffPositionMap {
  const starts: number[] = []
  const rowByLine = { new: new Map<number, number>(), old: new Map<number, number>() }
  const documentLines = { new: documentLineIndex(newLines), old: documentLineIndex(oldLines) }
  let offset = 0

  for (const [index, row] of rows.entries()) {
    starts.push(offset)
    offset += row.text.length + 1

    const side = sideOf(row, newLines, oldLines)
    if (!side) continue

    rowByLine[side].set(lineNumberOf(row, side) - 1, index)
  }

  return {
    lookupAt(target) {
      const index = lastAtOrBefore(starts, target)
      const row = index === null ? undefined : rows[index]
      if (index === null || !row) return { kind: 'none' }

      const side = sideOf(row, newLines, oldLines)
      if (!side) return { kind: 'none' }

      const inRow = Math.min(Math.max(0, target - starts[index]!), row.text.length)
      const segmentStart = row.text.lastIndexOf('\n', inRow - 1) + 1
      const line = documentLines[side].first(lineNumberOf(row, side) - 1)
      const position = {
        character: inRow - segmentStart,
        line: line + breaksBefore(row.text, inRow),
      }
      return { kind: 'file', position, side }
    },
    bufferOffsetAt(side, { character, line }) {
      const fileLine = documentLines[side].fileLineAt(line)
      const index = rowByLine[side].get(fileLine)
      if (index === undefined) return null

      const text = rows[index]!.text
      const segment = segmentAt(text, line - documentLines[side].first(fileLine))
      return starts[index]! + segment.start + Math.min(Math.max(0, character), segment.length)
    },
  }
}

/**
 * Where each file line starts among the document's lines. A line can hold breaks of its own: git
 * splits on LF alone, and the documents a language server sees also break at a lone CR, U+2028 and
 * U+2029, which the diff keeps as the LF the editor reads them as.
 */
function documentLineIndex(lines: readonly string[]) {
  const firsts: number[] = []
  let line = 0
  for (const text of lines) {
    firsts.push(line)
    line += 1 + breaksBefore(text, text.length)
  }
  return {
    first: (fileLine: number) => firsts[fileLine] ?? fileLine,
    fileLineAt: (documentLine: number) => lastAtOrBefore(firsts, documentLine) ?? documentLine,
  }
}

function breaksBefore(text: string, end: number): number {
  let count = 0
  for (
    let index = text.indexOf('\n');
    index !== -1 && index < end;
    index = text.indexOf('\n', index + 1)
  ) {
    count += 1
  }
  return count
}

function segmentAt(
  text: string,
  segment: number,
): { readonly start: number; readonly length: number } {
  let start = 0
  for (let index = 0; index < segment; index += 1) {
    const next = text.indexOf('\n', start)
    if (next === -1) break
    start = next + 1
  }
  const end = text.indexOf('\n', start)
  return { start, length: (end === -1 ? text.length : end) - start }
}

/** The last ascending value at or before `target`. Binary search: a hover asks on every pointer move. */
function lastAtOrBefore(values: readonly number[], target: number): number | null {
  if (values.length === 0 || target < values[0]!) return null

  let low = 0
  let high = values.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (values[middle]! <= target) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * Which text a row stands for, or null when it stands for none.
 *
 * A row belongs to a side only if it claims a line there AND renders it verbatim. Deliberately not
 * also a check on `row.type`: placeholders, separators and the empty-diff row carry no line number
 * at all, so the claim already excludes them, and a type list here would be a second spelling of
 * the projection's rules that could fall out of step with it. The verbatim check is what catches
 * the case neither a type nor a line number can see — a row the projection blanked.
 */
function sideOf(
  row: DiffRenderRow,
  newLines: readonly string[],
  oldLines: readonly string[],
): DiffFileSide | null {
  if (row.newLineNumber !== undefined && newLines[row.newLineNumber - 1] === row.text) return 'new'
  if (row.oldLineNumber !== undefined && oldLines[row.oldLineNumber - 1] === row.text) return 'old'

  return null
}

/** Only ever called for a side `sideOf` already accepted, which is what makes the `!` sound. */
function lineNumberOf(row: DiffRenderRow, side: DiffFileSide): number {
  return side === 'new' ? row.newLineNumber! : row.oldLineNumber!
}
