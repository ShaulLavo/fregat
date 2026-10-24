export { TypeScriptLspWorkspace } from './workspace'
export { type TypeScriptLspResolvedOptions } from './plugin'
export { createTypeScriptLspPlugin } from './pluginWithWorker'
export {
  TypeScriptLspWorkerOwner,
  createTypeScriptLspWorkerOwner,
  type TypeScriptLspWorkerLifecycleState,
  type TypeScriptLspWorkerOwnerOptions,
  type TypeScriptLspWorkerOwnerSnapshot,
} from './workerOwner'
export {
  diagnosticHighlightGroups,
  summarizeDiagnostics,
  type LanguageServerDiagnosticHighlightGroups as TypeScriptLspDiagnosticHighlightGroups,
  type LanguageServerDiagnosticSeverity as TypeScriptLspDiagnosticSeverity,
} from '@singapore-editor/lsp-plugin/diagnostics'
export type {
  ApplyWorkspaceEditRequest as TypeScriptLspWorkspaceEditRequest,
  ApplyWorkspaceEditResult as TypeScriptLspWorkspaceEditResult,
} from '@singapore-editor/lsp-plugin'
export {
  documentUriToFileName,
  fileNameToDocumentUri,
  isTypeScriptFileName,
  isTypeScriptLspSourceFileName,
  pathOrUriToDocumentUri,
  sourcePathToFileName,
} from './paths'
export type {
  TypeScriptLspDiagnosticCounts,
  TypeScriptLspDefinitionTarget,
  TypeScriptLspDiagnosticSummary,
  TypeScriptLspLibraryLoader,
  TypeScriptLspLibrarySource,
  TypeScriptLspNavigationKind,
  TypeScriptLspNavigationOpenMode,
  TypeScriptLspNavigationOptions,
  TypeScriptLspPlugin,
  TypeScriptLspPluginOptions,
  TypeScriptLspReferencesResult,
  TypeScriptLspSourceFile,
  TypeScriptLspStatus,
} from './types'
