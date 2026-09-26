export type { EditorRowPresentation } from '../rowPresentation'
export type { EditorPointHit, EditorMarkerHit } from '../pointQueries'
export {
  createEditorCapabilityToken,
  createEditorLanguageFeatureToken,
  registerAmbientEditorPlugin,
  EDITOR_MINIMAP_FEATURE,
  EDITOR_MINIMAP_FEATURE_ID,
  EDITOR_PASTE_HANDLER,
  EDITOR_PASTE_HANDLER_ID,
} from '../plugins'
export {
  EditorDecorationStore,
  projectDecorationRangeThroughEdits,
} from '../editor/decorationStore'
export type { AmbientEditorPlugin } from '../plugins'
export type {
  EditorDecoration,
  EditorDecorationRange,
  EditorDecorationSpec,
  EditorDecorationSurface,
} from '../editor/decorationStore'
export {
  createSemanticTokenLayer,
  SEMANTIC_TOKEN_Z_INDEX,
  type SemanticTokenLayer,
  type SemanticTokenLayerController,
  type SemanticTokenLayerOptions,
} from '../semanticTokenLayer'
export type {
  SemanticTokenDropReason,
  SemanticTokenPayload,
  SemanticTokenPushResult,
  SemanticTokenRangeRequest,
  SemanticTokenSpan,
} from '../syntax'
export { EDITOR_FIND_FEATURE, EDITOR_FIND_FEATURE_ID } from '../editor/findFeature'
export type { EditorFindFeature } from '../editor/findFeature'
export {
  EDITOR_SNIPPET_TOKENS_FEATURE,
  EDITOR_SNIPPET_TOKENS_FEATURE_ID,
} from '../editor/snippetTokensFeature'
export type {
  EditorSnippetTokenSource,
  EditorSnippetTokensFeature,
} from '../editor/snippetTokensFeature'
export {
  editorLanguageConfiguration,
  registerEditorLanguageConfiguration,
} from '../editor/languageConfiguration'
export type {
  EditorAutoClosingPair,
  EditorBlockCommentTokens,
  EditorBracketPair,
  EditorCommentTokens,
  EditorEnterAction,
  EditorFoldingRules,
  EditorIndentationRules,
  EditorLanguageConfiguration,
  EditorOnEnterRule,
} from '../editor/languageConfiguration'
export type { EditorSnippetMirror, EditorSnippetStop } from '../plugins'
// Experimental: the one authoring model for plugins (Plan 122 phase 3).
export {
  createChannel,
  createPlugin,
  derive,
  documentInput,
  selectionInput,
  textInput,
  themeInput,
  tokensInput,
  viewportInput,
  visibleRowsInput,
} from '../createPlugin'
export type { EditorCursorStyle, EditorKeyDecision, EditorKeyParticipant } from '../plugins'
export type {
  EditorChannel,
  EditorChannelPolicy,
  EditorInput,
  EditorPluginDefinition,
  EditorViewScope,
  EditorViewState,
} from '../createPlugin'
export { reindentEditsForRanges } from '../editor/reindent'
export type { EditorReindentOptions } from '../editor/reindent'
export type {
  EditorCapabilityToken,
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
  EditorDisposable,
  EditorGutterContribution,
  EditorGutterRowContext,
  EditorGutterWidthContext,
  EditorHighlighterProvider,
  EditorHighlighterSession,
  EditorHighlighterSessionOptions,
  EditorHighlightResult,
  EditorInitialHighlightStatus,
  EditorInitialPaintEvent,
  EditorInjectedTextRow,
  EditorInjectedTextRowProvider,
  EditorInjectedTextRowProviderContext,
  EditorInlineReplacementContext,
  EditorInlineReplacementProvider,
  EditorInlineReplacementProviderOptions,
  EditorInlineReplacementTrigger,
  EditorLanguageFeatureSelector,
  EditorLanguageFeatureToken,
  EditorLogEditorContext,
  EditorLogError,
  EditorLogEvent,
  EditorLogInput,
  EditorLogger,
  EditorLogLevel,
  EditorMinimapDecoration,
  EditorMinimapDecorationPosition,
  EditorMinimapFeature,
  EditorMinimapSectionHeaderStyle,
  EditorMountedChunkPaintJSON,
  EditorMountedChunkPaintPartJSON,
  EditorOverlaySide,
  EditorPasteContext,
  EditorPasteHandler,
  EditorPasteTarget,
  EditorPlugin,
  EditorPluginContext,
  EditorPluginLifecycleState,
  EditorResolvedSelection,
  EditorSelectionRange,
  EditorSelectionRangeContext,
  EditorSelectionRangeProvider,
  EditorTextAnchor,
  EditorTrackedPoint,
  EditorTrackedRanges,
  EditorThemeJSON,
  EditorTokenStyleJSON,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorPressParticipant,
  EditorViewContributionProvider,
  EditorViewContributionUpdateKind,
  EditorViewContributionInput,
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
} from '../plugins'
export { registerWheelScrollTarget } from '../virtualization/wheelScrollTarget'
export { parseSnippet, snippetInitialSelection } from '../editor/snippet'
export { serializeEditorViewSnapshot } from '../editor/viewSnapshot'
export type { TextReadSnapshot } from '../documentTextSnapshot'
export type { EditorContributionChange, EditorLineStartsView } from '../plugins'
export type { ParsedSnippet, SnippetRange } from '../editor/snippet'
