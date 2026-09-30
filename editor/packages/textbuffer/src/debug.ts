// Opt-in inspection; this module is not reachable from the main entry point.
export { debugPieceTable } from './pieceTable'
export type { PieceBufferId, PieceTableSnapshot } from './pieceTableTypes'
export { validatePieceTreeInvariants } from './inspection'
export type { PieceTreeIssue, PieceTreeIssueKind, PieceTreeValidation } from './inspection'
export { createPieceTreeInspectionSession } from './inspectionSession'
export type {
  PieceInspectionNode,
  PieceTreeInspection,
  PieceNodeChange,
  PieceTreeComparison,
  PieceInspectionOptions,
} from './inspectionSession'
export {
  formatPieceTree,
  formatPieceTreeInspection,
  formatPieceInspectionNode,
} from './inspectionFormat'
