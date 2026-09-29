export type {
  Anchor as PieceTableAnchor,
  AnchorBias,
  AnchorLiveness,
  PieceBufferId,
  PieceTableEdit,
  PieceTableSnapshot,
  Point,
  RealAnchor,
  ResolvedAnchor,
} from './pieceTableTypes'

export type {
  DocumentLineEnding,
  NormalizedDocumentText,
  PieceTableDocumentTextOptions,
  PieceTableWalker,
  PieceTableWalkerChunk,
} from './pieceTable'

export {
  Anchor,
  anchorAfter,
  anchorAt,
  anchorBefore,
  applyBatchToPieceTable,
  applyDocumentLineEnding,
  compareAnchors,
  createPieceTableSnapshot,
  createPieceTableWalker,
  DEFAULT_DOCUMENT_LINE_ENDING,
  deleteFromPieceTable,
  debugPieceTable,
  detectDocumentLineEnding,
  diffPieceTableSnapshots,
  getPieceTableLength,
  hasByteOrderMark,
  insertIntoPieceTable,
  lineRange,
  materializePieceTableFullText,
  normalizeDocumentText,
  normalizeLineEndings,
  offsetToPoint,
  pieceTableByteOrderMark,
  pieceTableContainsUnusualLineTerminators,
  pieceTableDocumentText,
  pieceTableLineEnding,
  pieceTableSnapshotsHaveSameText,
  pointToOffset,
  readPieceTableLine,
  readPieceTableTextRange,
  resolveAnchor,
  resolveAnchorLinear,
  retainPieceTableSnapshot,
  streamPieceTablePieces,
  streamPieceTableTextChunks,
  UTF8_BYTE_ORDER_MARK,
} from './pieceTable'

export type { CreatePieceTableSnapshotOptions } from './snapshot'
export type { PieceTableBufferOptions } from './buffers'
export { snapBatchEditRanges } from './edits'
