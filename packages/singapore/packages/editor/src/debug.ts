// Opt-in diagnostics. Importing the document/editor facade never loads inspection code.
// Opt-in diagnostics. Importing the document/editor facade never loads inspection code.
export { debugPieceTable } from '@singapore-editor/textbuffer'
export type { PieceBufferId, PieceTableSnapshot } from '@singapore-editor/textbuffer'
export { validatePieceTreeInvariants } from '@singapore-editor/textbuffer/debug'
export type {
  PieceTreeIssue,
  PieceTreeIssueKind,
  PieceTreeValidation,
} from '@singapore-editor/textbuffer/debug'
export { createPieceTreeInspectionSession } from '@singapore-editor/textbuffer/debug'
export type {
  PieceInspectionNode,
  PieceTreeInspection,
  PieceNodeChange,
  PieceTreeComparison,
  PieceInspectionOptions,
} from '@singapore-editor/textbuffer/debug'
export {
  formatPieceTree,
  formatPieceTreeInspection,
  formatPieceInspectionNode,
} from '@singapore-editor/textbuffer/debug'
export { getPieceTreeSnapshot } from './documentTextSnapshot'
export { forEachBufferSpan } from '@singapore-editor/textbuffer/internal/buffers'
