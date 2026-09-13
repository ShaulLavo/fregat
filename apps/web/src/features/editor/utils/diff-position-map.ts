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
 * The buffer a diff editor holds is `joinRenderLines(rows)` — the two sides interleaved, plus
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
      const index = rowIndexAt(starts, target)
      const row = index === null ? undefined : rows[index]
      if (index === null || !row) return { kind: 'none' }

      const side = sideOf(row, newLines, oldLines)
      if (!side) return { kind: 'none' }

      const character = Math.min(Math.max(0, target - starts[index]!), row.text.length)
      return { kind: 'file', position: { character, line: lineNumberOf(row, side) - 1 }, side }
    },
    bufferOffsetAt(side, { character, line }) {
      const index = rowByLine[side].get(line)
      if (index === undefined) return null

      const row = rows[index]!
      return starts[index]! + Math.min(Math.max(0, character), row.text.length)
    },
  }
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

/** The row containing an offset. Binary search, because a hover asks on every pointer move. */
function rowIndexAt(starts: readonly number[], offset: number): number | null {
  if (starts.length === 0 || offset < 0) return null

  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (starts[middle]! <= offset) low = middle
    else high = middle - 1
  }

  return low
}
