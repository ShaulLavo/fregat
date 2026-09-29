export {
  createEditorSyntaxSession,
  createEditorRuntimeSessionId,
  createEmptySyntaxResult,
  createEmptySyntaxSession,
  createSyntaxLanguageConfiguration,
  createSyntaxProjectionTag,
  createSyntaxSnapshotTag,
  EditorTokenStore,
  isEditorSyntaxLanguage,
  packEditorTokens,
  packedEditorTokenTransfers,
  styleForTreeSitterCapture,
  toEditorTokenStore,
  treeSitterCapturesToEditorTokens,
  unpackEditorTokens,
} from '../syntax'
export type {
  EditorTokenInput,
  EditorTokenStoreOrigin,
  PackedEditorTokenPatch,
  PackedEditorTokens,
} from '../syntax'
export type {
  BracketInfo,
  EditorSyntaxCapture,
  EditorSyntaxDegradedState,
  EditorSyntaxEditSummary,
  EditorSyntaxError,
  EditorSyntaxInjection,
  EditorSyntaxLanguageId,
  EditorSyntaxLanguageConfiguration,
  EditorSyntaxMode,
  EditorSyntaxProjectionTag,
  EditorSyntaxProvider,
  EditorSyntaxRange,
  EditorSyntaxResult,
  EditorSyntaxResultOptions,
  EditorSyntaxServiceRequest,
  EditorSyntaxSession,
  EditorSyntaxFoldingSupport,
  EditorSyntaxSessionOptions,
  EditorSyntaxSnapshotTag,
  FoldRange,
} from '../syntax'
export type { EditorToken, EditorTokenStyle } from '../tokens'
export { createSemanticTokenStyles } from '../syntax'
export type {
  SemanticTokenDropReason,
  SemanticTokenPayload,
  SemanticTokenPushResult,
  SemanticTokenRangeRequest,
  SemanticTokenSpan,
  SemanticTokenStyleOptions,
  SemanticTokenStyles,
} from '../syntax'
// The trie the capture table and the semantic table both resolve through. Exported so a package
// outside this one can build a scope table of its own against the same resolution rules rather than
// inventing a second, subtly different, longest-prefix match.
export { createEditorScopeStyles } from '../theme'
export type { EditorScopeStyleRule, EditorScopeStyles } from '../theme'
