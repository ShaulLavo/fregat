import type * as lsp from 'vscode-languageserver-protocol'

import type { TextEdit } from '@singapore-editor/core'
import {
  lspPositionToOffsetInSnapshot,
  type LspTextDocumentSnapshot,
  type LspTextSnapshot,
} from '@singapore-editor/lsp'

import { minimalReplacementEdits, REDIFF_LENGTH_LIMIT } from './minimalEdits'

/**
 * Converts server formatting edits into buffer edits.
 *
 * Returned in descending order and with overlaps dropped, because the batch applicator rejects
 * overlapping edits outright — a formatter that returns a whole-document edit plus a nested one
 * would otherwise throw rather than format.
 *
 * What survives is re-diffed against the text it replaces, so a reply that rewrites the document to
 * change one line touches only that line.
 */
export function prepareFormattingEdits(
  document: LspTextDocumentSnapshot,
  edits: readonly lsp.TextEdit[] | null,
): TextEdit[] {
  if (!edits || edits.length === 0) return []

  const converted = edits
    .map((edit) => ({
      from: lspPositionToOffsetInSnapshot(document, edit.range.start),
      text: edit.newText,
      to: lspPositionToOffsetInSnapshot(document, edit.range.end),
    }))
    .filter((edit) => edit.from <= edit.to)
    // Earliest first, and the longest of any that start together: when a formatter sends a
    // whole-document edit alongside a nested one, the outer edit is the real answer and keeping the
    // fragment instead would rewrite a slice of the file with a slice of the result.
    .sort((left, right) => left.from - right.from || right.to - left.to)

  const applied: TextEdit[] = []
  let keptThrough = Number.NEGATIVE_INFINITY
  for (const edit of converted) {
    if (edit.from < keptThrough) continue

    const previous = applied[applied.length - 1]
    // Edits that meet are joined first: two fragments that cancel each other out are invisible
    // while they are compared apart. Joining stops at the length past which the comparison is
    // skipped anyway, where a wider span would only buy a wider rewrite.
    if (previous && previous.to === edit.from && joinFitsRediff(previous, edit)) {
      applied[applied.length - 1] = {
        from: previous.from,
        text: previous.text + edit.text,
        to: edit.to,
      }
    } else {
      applied.push(edit)
    }
    keptThrough = edit.to
  }

  const minimal = applied.flatMap((edit) =>
    minimalReplacementEdits(
      document.textSnapshot.readRange(edit.from, edit.to),
      edit.text,
      edit.from,
    ),
  )

  // Descending, so applying them in order cannot shift the offsets of the ones still to come.
  return minimal.reverse()
}

function joinFitsRediff(left: TextEdit, right: TextEdit): boolean {
  const joined = Math.max(right.to - left.from, left.text.length + right.text.length)
  return joined <= REDIFF_LENGTH_LIMIT
}

/** Whether the edits would leave the document unchanged, so a no-op formatter records no change. */
export function formattingChangesText(text: LspTextSnapshot, edits: readonly TextEdit[]): boolean {
  return edits.some((edit) => text.readRange(edit.from, edit.to) !== edit.text)
}

export function formattingOptions(tabSize: number): lsp.FormattingOptions {
  return {
    insertSpaces: true,
    tabSize: Math.max(1, tabSize),
  }
}
