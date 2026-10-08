export type { EditorPointHit, EditorMarkerHit } from './pointQueries'
import './style.css'

export { createBracketMatchPlugin, EDITOR_BRACKET_MATCH_PLUGIN_ID } from './bracketMatchPlugin'
export type { EditorBracketMatchPluginOptions } from './bracketMatchPlugin'
export {
  bracketJumpTargetOffset,
  collectBracketLevels,
  findBracketMatchAtCaret,
} from './editor/bracketMatching'
export type { BracketLevel, BracketLevelOptions, BracketMatch } from './editor/bracketMatching'
export { createDocumentLinkPlugin, EDITOR_DOCUMENT_LINK_PLUGIN_ID } from './documentLinkPlugin'
export type { EditorDocumentLinkPluginOptions } from './documentLinkPlugin'
export {
  createOccurrenceHighlightPlugin,
  EDITOR_OCCURRENCE_HIGHLIGHT_PLUGIN_ID,
} from './occurrenceHighlightPlugin'
export type { EditorOccurrenceHighlightPluginOptions } from './occurrenceHighlightPlugin'
export type {
  EditorSuspiciousCharactersOptions,
  SuspiciousCharacterKind,
  SuspiciousCharacterRange,
} from './unicodeHighlight'
export { suspiciousCharacterRanges } from './unicodeHighlight'
export {
  createMergeConflictPlugin,
  EDITOR_MERGE_CONFLICT_FEATURE,
  EDITOR_MERGE_CONFLICT_FEATURE_ID,
} from './mergeConflictPlugin'
export type { EditorFindFeature } from './editor/findFeature'
export { Editor } from './editor/Editor'
export { createEditorPreparedDocument } from './editor/preparedDocument'
export type {
  CreateEditorPreparedDocumentOptions,
  EditorPreparedDocument,
  EditorPreparedDocumentMatch,
  EditorPreparedDocumentPayload,
  EditorPreparedHighlighterBorrow,
  EditorPreparedStageOutcome,
  EditorPreparedStageRequest,
  EditorPreparedStructuralConfiguration,
  EditorPreparedStructuralBorrow,
  EditorPreparedTagValue,
  EditorPreparedTabSizePolicy,
} from './editor/preparedDocument'
export {
  observeEditorMountTiming,
  resetEditorInstanceCount,
  setHighlightRegistry,
} from './editor/runtime'
export {
  createEditorConsoleLogger,
  createEditorConsoleLoggingPlugin,
  createEditorLoggingPlugin,
} from './logging'
export {
  createMergeConflictDocumentText,
  parseMergeConflicts,
  resolveMergeConflict,
} from './mergeConflicts'
export type { EditorSetSelectionOptions } from './editor/selectionReveal'
export type {
  EditorChangeHandler,
  EditorDocumentMode,
  EditorEditability,
  EditorEditHistoryMode,
  EditorEditInput,
  EditorEditOptions,
  EditorEditSelection,
  EditorOpenDocumentOptions,
  EditorOptions,
  EditorRangeDecoration,
  EditorScrollMode,
  EditorGutterScroll,
  EditorScrollPosition,
  EditorSelectionSyncMode,
  EditorSessionChangeHandler,
  EditorSessionOptions,
  EditorSetTextOptions,
  EditorState,
  EditorSyntaxStatus,
  HighlightRegistry,
} from './editor/types'
export type { EditorCommandContext, EditorCommandId } from './editor/commands'
export type { EditorAnyCommandId } from './editor/commandCatalog'
export {
  baseEditorKeymap,
  defaultEditorPacks,
  vscodeNavigationPack,
  vscodeSelectionPack,
  vscodeEditingPack,
  vscodeAdvancedEditingPack,
  vscodeMultiCursorPack,
  vscodeFindPack,
  vscodeFoldingPack,
  vscodeLspNavigationPack,
  vscodeLspEditingPack,
  vscodeInlineSuggestPack,
  suggestPack,
  markdownPack,
  readonlyDiffPack,
} from './keymap/presets'
export type { EditorKeymapOptions, EditorKeymapPack } from './keymap/presets'
export type {
  EditorHotkeysHost,
  EditorKeymapContext,
  EditorKeymapMetadata,
  EditorKeymapNodeOptions,
} from './editor/hotkeys'
export type {
  EditorMergeConflictFeature,
  EditorMergeConflictPluginOptions,
} from './mergeConflictPlugin'
export type {
  CreateMergeConflictDocumentTextOptions,
  MergeConflictRegion,
  MergeConflictResolution,
  MergeConflictResolutionResult,
  MergeConflictSide,
  TextOffsetRange,
} from './mergeConflicts'
export type {
  EditorCursorLineHighlightOptions,
  HiddenCharactersMode,
} from './virtualization/virtualizedTextViewTypes'
export type { EditorSyntaxTheme, EditorSyntaxThemeColor, EditorTheme } from './theme'
export type { EditorSyntaxProvider } from './syntax'
export type {
  EditorCapabilityContribution,
  EditorCapabilityContributionContext,
  EditorCapabilityContributionProvider,
  EditorCommandContribution,
  EditorCommandContributionContext,
  EditorCommandContributionProvider,
  EditorCommandHandler,
  EditorDecorationContribution,
  EditorDecorationContributionContext,
  EditorDecorationContributionProvider,
  EditorEditContribution,
  EditorEditContributionContext,
  EditorEditContributionProvider,
  EditorGutterContribution,
  EditorGutterRowContext,
  EditorGutterWidthContext,
  EditorInitialHighlightStatus,
  EditorInitialPaintEvent,
  EditorInjectedTextRow,
  EditorInjectedTextRowProvider,
  EditorInjectedTextRowProviderContext,
  EditorLogEditorContext,
  EditorLogError,
  EditorLogEvent,
  EditorLogInput,
  EditorLogger,
  EditorLogLevel,
  EditorMountedChunkPaintJSON,
  EditorMountedChunkPaintPartJSON,
  EditorPlugin,
  EditorPluginContext,
  EditorPluginLifecycleState,
  EditorResolvedSelection,
  EditorSelectionRange,
  EditorThemeJSON,
  EditorTokenStyleJSON,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewContributionUpdateKind,
  EditorViewportSnapshot,
  EditorViewportSnapshotJSON,
  EditorViewSnapshot,
  EditorViewSnapshotJSON,
  EditorVisibleChunkSnapshot,
  EditorVisibleChunkSnapshotJSON,
  EditorVisibleGutterLayoutJSON,
  EditorVisiblePaintCapture,
  EditorVisiblePaintLayer,
  EditorVisiblePaintRectangle,
  EditorVisiblePaintChunkJSON,
  EditorVisiblePaintRowJSON,
  EditorVisiblePaintRunJSON,
  EditorVisibleRowSnapshot,
  EditorVisibleRowSnapshotJSON,
  EditorVisibleSnapshot,
  EditorVisibleSnapshotJSON,
} from './plugins'
export type { EditorDisposable } from './editor/disposables'
export type {
  EditorHighlightResult,
  EditorHighlighterProvider,
  EditorHighlighterSession,
  EditorHighlighterSessionOptions,
} from './syntax/highlighter'

export type { JumpCause } from './editor/jumpHistory'

export { createEditorDocumentAnalysis } from './editor/documentAnalysis'
export type {
  EditorDocumentAnalysis,
  EditorDocumentContributions,
  EditorStructuralContributionRequest,
  EditorHighlighterContributionRequest,
  EditorAnalysisRead,
  EditorAnalysisStructuralRequest,
  EditorAnalysisHighlighterRequest,
  EditorRetainedSyntaxSession,
  EditorRetainedHighlighterSession,
  EditorAnalysisDisplayDemand,
  EditorAnalysisRangeInterest,
} from './editor/documentAnalysis'

export { editorCommandMutates, editorCommandDeclaration } from './editor/commandCatalog'

export type { DocumentRead, DocumentRevision } from './editor/documentDelivery'
export type { EditorStructuralOperation, EditorHighlighterOperation } from './document/operations'
export {
  createEditorStructuralOperation,
  createEditorHighlighterOperation,
} from './editor/operationDefinitions'
export type {
  EditorStructuralOperationContext,
  EditorHighlighterOperationContext,
} from './document/operations'

export type {
  DocumentOperation,
  DocumentOperationOptions,
  DocumentContributionLease,
} from './editor/contributionOperation'

export type {
  DocumentContributionAudience,
  DocumentContributionOwner,
  DocumentContributionDemand,
  DocumentContributionTask,
  DocumentContributionOutcome,
} from './editor/contributionDemand'
