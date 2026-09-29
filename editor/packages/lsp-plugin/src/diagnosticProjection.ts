import type { TextEdit } from '@singapore-editor/core/document'
import {
  type EditorContributionChange,
  projectDecorationRangeThroughEdits,
} from '@singapore-editor/core/extensions'
import {
  lspPositionToOffsetInSnapshot,
  offsetToLspPositionInSnapshot,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

export type SnapshotDocumentSession = {
  readonly previousDocument: LspTextDocumentSnapshot
  readonly nextDocument: LspTextDocumentSnapshot
  readonly change: EditorContributionChange | null
}

/**
 * A diagnostic whose range has been projected onto the post-edit text.
 * Structurally identical to {@link lsp.Diagnostic}; the alias exists to
 * document intent at call sites that consume already-projected results.
 */
export type ProjectedDiagnostic = lsp.Diagnostic

/**
 * A diagnostic describes text the server has already seen, so neither edge takes in what is typed
 * against it — the character you add after a squiggle is not yet part of the problem it reports.
 */
const DIAGNOSTIC_STICKINESS = { startBias: 'right', endBias: 'left' } as const

export function projectDiagnosticsInSnapshot(
  diagnostics: readonly lsp.Diagnostic[],
  documentSession: SnapshotDocumentSession,
): readonly ProjectedDiagnostic[] {
  return projectDiagnosticsThroughSnapshotChange(
    documentSession.previousDocument,
    documentSession.nextDocument,
    diagnostics,
    documentSession.change,
  )
}

function editsForChange(change: EditorContributionChange | null): readonly TextEdit[] {
  if (!change) return []
  return change.edits
}

/**
 * Diagnostic ranges resolved to offsets once per publish, so a pointer move over a large file
 * compares numbers instead of walking the line index for every diagnostic.
 */
export type DiagnosticOffsetIndex = {
  readonly diagnostics: readonly lsp.Diagnostic[]
  readonly starts: readonly number[]
  readonly ends: readonly number[]
}

export function indexDiagnosticOffsets(
  document: LspTextDocumentSnapshot,
  diagnostics: readonly lsp.Diagnostic[],
): DiagnosticOffsetIndex {
  const starts: number[] = []
  const ends: number[] = []
  for (const diagnostic of diagnostics) {
    starts.push(lspPositionToOffsetInSnapshot(document, diagnostic.range.start))
    ends.push(lspPositionToOffsetInSnapshot(document, diagnostic.range.end))
  }
  return { diagnostics, starts, ends }
}

/**
 * The diagnostics whose range contains `offset`. Zero-width diagnostics match only their exact
 * start offset.
 */
export function diagnosticsAtOffset(
  index: DiagnosticOffsetIndex,
  offset: number,
): readonly lsp.Diagnostic[] {
  const matches: lsp.Diagnostic[] = []
  for (let position = 0; position < index.diagnostics.length; position += 1) {
    if (!rangeContainsOffset(index.starts[position]!, index.ends[position]!, offset)) continue
    matches.push(index.diagnostics[position]!)
  }
  return matches
}

function rangeContainsOffset(start: number, end: number, offset: number): boolean {
  if (end > start) return offset >= start && offset <= end
  return offset === start
}

function projectDiagnosticsThroughSnapshotChange(
  previousDocument: LspTextDocumentSnapshot,
  nextDocument: LspTextDocumentSnapshot,
  diagnostics: readonly lsp.Diagnostic[],
  change: EditorContributionChange | null,
): readonly lsp.Diagnostic[] {
  if (diagnostics.length === 0) return diagnostics

  const edits = editsForChange(change)
  if (edits.length === 0) return []

  const projected: lsp.Diagnostic[] = []
  for (const diagnostic of diagnostics) {
    const next = projectDiagnosticThroughSnapshotEdits(
      previousDocument,
      nextDocument,
      diagnostic,
      edits,
    )
    if (next) projected.push(next)
  }

  return projected
}

function projectDiagnosticThroughSnapshotEdits(
  previousDocument: LspTextDocumentSnapshot,
  nextDocument: LspTextDocumentSnapshot,
  diagnostic: lsp.Diagnostic,
  edits: readonly TextEdit[],
): lsp.Diagnostic | null {
  const start = lspPositionToOffsetInSnapshot(previousDocument, diagnostic.range.start)
  const end = lspPositionToOffsetInSnapshot(previousDocument, diagnostic.range.end)
  // An edit that reaches into a flagged span leaves the marker over whatever survives rather than
  // taking it away. This projection only has to hold until the server republishes, and deleting a
  // character out of a bad identifier rarely makes it good — a squiggle that blinks out under the
  // caret claims the problem is fixed, which is the more misleading of the two wrong answers. The
  // price, and the change from what shipped before this milestone, is that the painted extent can
  // be shorter than the one the server actually described.
  const range = projectDecorationRangeThroughEdits({ start, end, ...DIAGNOSTIC_STICKINESS }, edits)
  if (!range) return null

  return {
    ...diagnostic,
    range: {
      start: offsetToLspPositionInSnapshot(nextDocument, range.start),
      end: offsetToLspPositionInSnapshot(nextDocument, range.end),
    },
  }
}
