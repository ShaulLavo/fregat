export {
  Anchor,
  anchorAfter,
  anchorAt,
  anchorBefore,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  createPieceTableWalker,
  deleteFromPieceTable,
  diffPieceTableSnapshots,
  getPieceTableLength,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  // A host that must not silently rewrite a file needs to know the ingestion folded U+2028/U+2029
  // into real line breaks, because the folded text no longer carries the evidence.
  pieceTableContainsUnusualLineTerminators,
  pieceTableDocumentText,
  pieceTableSnapshotsHaveSameText,
  pointToOffset,
  readPieceTableTextRange,
  resolveAnchor,
  streamPieceTablePieces,
  streamPieceTableTextChunks,
} from '@singapore-editor/textbuffer'
export {
  createDocumentSession,
  acquireDocumentMutationLease,
  beginReverseDocumentTransactionSequence,
  commitPreparedDocumentTransaction,
  commitPreparedDocumentTransactionSequenceSegment,
  completePreparedDocumentTransactionSequence,
  completeReverseDocumentTransactionSequence,
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  createStaticDocumentSession,
  getDocumentMutationLeaseState,
  prepareDocumentTransaction,
  prepareDocumentTransactionSequence,
  releaseDocumentMutationLease,
  releaseDocumentTransactionReceipt,
  reverseDocumentTransaction,
  reverseNextDocumentTransactionSequenceSegment,
  rotateDocumentSyncSegment,
  sealDocumentTransactionReceipt,
  subscribeDocumentMutationLeaseState,
} from '../documentSession'
export { createHistoryViewer, layoutHistoryGraph } from '../historyViewer'
export { SERIALIZED_EDITOR_HISTORY_VERSION } from '../historySerialization'
export type {
  SerializedEditorHistory,
  SerializedEditorHistoryNode,
  SerializedEditorHistorySelection,
} from '../historySerialization'
export type { EditorCollapsedRegion, EditorManualFold, EditorViewFoldState } from '../viewFolds'
export type {
  HistoryComparison,
  HistoryComparisonSide,
  HistoryGraphLayout,
  HistoryGraphLayoutEdge,
  HistoryGraphLayoutNode,
  HistoryViewer,
  HistoryViewerOptions,
  HistoryViewerState,
} from '../historyViewer'
export { createDocumentLogicalRevisionScope } from '../editor/editChain'
export { documentTextRoundTripStatus } from '@singapore-editor/textbuffer/internal/lineEndings'
export { createDocumentTextSnapshot, createStringTextSnapshot } from '../documentTextSnapshot'
export {
  characterClassAt,
  clampTextOffset,
  clampTextOffsetRange,
  codePointSizeAt,
  compareTextOffsetRanges,
  isWholeWordRange,
  isWordCodePointAt,
  isWordCodePointBefore,
  lineRangeAtOffset,
  nextCodePointOffset,
  nextWordOffset,
  normalizeTextOffsetRanges,
  previousCodePointOffset,
  previousCodePointStart,
  previousWordOffset,
  wordRangeAtOffset,
} from '../textRanges'
export type {
  AnchorBias,
  AnchorLiveness,
  PieceTableAnchor,
  PieceTableEdit,
  PieceTableSnapshot,
  PieceTableDocumentTextOptions,
  PieceTableWalker,
  PieceTableWalkerChunk,
  Point,
  ResolvedAnchor,
} from '@singapore-editor/textbuffer'
export type {
  AcquireDocumentMutationLeaseResult,
  BeginReverseDocumentTransactionSequenceResult,
  CompletePreparedDocumentSequenceResult,
  CompleteReverseDocumentTransactionSequenceResult,
  DocumentSession,
  DocumentSessionApplyEditsOptions,
  DocumentSessionChange,
  DocumentSessionChangeKind,
  EditorHistoryBarrier,
  EditorHistoryGraph,
  EditorHistoryGraphNode,
  EditorTextBufferOptions,
  HistoryNodeId,
  DocumentSessionEditHistoryMode,
  DocumentSessionEditSelection,
  DocumentSessionSelectionOptions,
  DocumentSessionSelectionRange,
  DocumentMutationLease,
  DocumentMutationLeaseState,
  DocumentMutationLeaseStateListener,
  DocumentTransactionCommitOptions,
  DocumentTransactionCommitTarget,
  DocumentTransactionHistory,
  DocumentTransactionReceipt,
  DocumentTransactionSequenceReverseCursor,
  DocumentTransactionSequenceSegmentInput,
  DocumentTransaction,
  DocumentTransactionMetadata,
  EditorBufferSession,
  EditorTextBuffer,
  EditorTextBufferChange,
  EditorTextBufferChangeListener,
  EditorTimingMeasurement,
  EditorViewMetadataValue,
  EditorViewScrollPosition,
  EditorViewSession,
  PreparedDocumentCommitResult,
  PreparedDocumentSequenceSegmentCommitResult,
  PreparedDocumentTransaction,
  PreparedDocumentTransactionSequence,
  ReleaseDocumentMutationLeaseResult,
  ReleaseDocumentTransactionResult,
  ReverseDocumentTransactionResult,
  ReverseDocumentTransactionSequenceSegmentResult,
  RotateDocumentSyncSegmentResult,
  SealDocumentTransactionResult,
} from '../documentSession'
export type {
  DocumentChangesSinceSyncPoint,
  DocumentLogicalRevisionScope,
  DocumentSyncPoint,
  DocumentSyncSegment,
} from '../editor/editChain'
export type {
  DocumentTextRoundTripIssue,
  DocumentTextRoundTripStatus,
} from '@singapore-editor/textbuffer/internal/lineEndings'
export type {
  DocumentTextSnapshot,
  TextLineRange,
  TextReadSnapshot,
  TextSnapshot,
} from '../documentTextSnapshot'
export type { SelectionAffinity } from '../selections'
export type { EditorDocument, TextEdit } from '../tokens'
export type { TextCharacterClass, TextOffsetRange } from '../textRanges'

export type { TextStorageMaintenanceStats } from '../textStorageMaintenance'
export {
  createAnchorSelection,
  createSelectionSet,
  normalizeSelectionSet,
  resolveSelection,
} from '../selections'
export type { AnchorSelection, SelectionSet } from '../selections'
export { documentSessionChangeTextSnapshot } from '../documentSession'
