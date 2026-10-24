import type { PieceTableTreeSnapshot } from './pieceTableTypes'
import { materializePieceTableFullText } from './reads'
import {
  applyDocumentLineEnding,
  DEFAULT_DOCUMENT_LINE_ENDING,
  type DocumentLineEnding,
} from './lineEndings'

export const pieceTableLineEnding = (snapshot: PieceTableTreeSnapshot): DocumentLineEnding =>
  snapshot.buffers.lineEnding ?? DEFAULT_DOCUMENT_LINE_ENDING

export const pieceTableByteOrderMark = (snapshot: PieceTableTreeSnapshot): string =>
  snapshot.buffers.byteOrderMark ?? ''

// The one thing ingestion changed that saving cannot change back. A host that
// wants to warn before it overwrites the file — or to refuse to open it at all —
// has no other way to learn it happened, because the folded text reads as an
// ordinary LF document from here on.
export const pieceTableContainsUnusualLineTerminators = (
  snapshot: PieceTableTreeSnapshot,
): boolean => snapshot.buffers.containsUnusualLineTerminators ?? false

export type PieceTableDocumentTextOptions = {
  // Defaults to the line ending the document was ingested with.
  readonly lineEnding?: DocumentLineEnding
  readonly preserveByteOrderMark?: boolean
}

// The inverse of ingestion: re-expands LF to the document's own line ending and
// re-attaches its BOM. Hosts that persist the buffer should save this, not
// materializePieceTableFullText, or a CRLF file silently becomes an LF file on
// first save and every line of it shows as changed in git.
//
// Deliberately not a full inverse: U+2028/U+2029 folded at ingestion come back
// as LF. Restoring them would re-plant the row-geometry landmine the fold was
// there to remove. A host that needs to warn about the loss reads
// `pieceTableContainsUnusualLineTerminators`, which the snapshot carries from
// ingestion for exactly that purpose.
export const pieceTableDocumentText = (
  snapshot: PieceTableTreeSnapshot,
  options: PieceTableDocumentTextOptions = {},
): string => {
  const lineEnding = options.lineEnding ?? pieceTableLineEnding(snapshot)
  const preserveByteOrderMark = options.preserveByteOrderMark ?? true
  const body = applyDocumentLineEnding(materializePieceTableFullText(snapshot), lineEnding)
  return preserveByteOrderMark ? `${pieceTableByteOrderMark(snapshot)}${body}` : body
}
