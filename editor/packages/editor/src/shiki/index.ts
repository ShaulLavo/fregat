export { createIncrementalTokenizer } from './tokenizer'
export {
  createShikiHighlighterPlugin,
  createShikiHighlighterProvider,
  shikiLanguageForDocument,
} from './plugin'
export {
  EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS,
  editorThemeToShikiTheme,
  editorThemeToShikiTokenColors,
} from './theme'
export { editorThemeFromShikiTheme } from './theme-extract'
export { editorThemeFromVscodeTheme, VSCODE_THEMES } from './vscode-themes'
export { canUseShikiWorker, createShikiWorkerOwner, ShikiWorkerOwner } from './workerClient'

export { snapshotToEditorTokens, tokenLinesToEditorTokens } from './editor-tokens'

export type {
  CreateIncrementalTokenizerOptions,
  CreateIncrementalTokenizerResult,
  IncrementalTokenizer,
  IncrementalTokenizerSnapshot,
  LineTokens,
  StatesEqualFn,
  TokenizeLineFn,
  TokenLineSnapshot,
  TokenPatch,
} from './tokenizer'
export type {
  ShikiHighlighterPluginOptions,
  ShikiLanguageMap,
  ShikiLanguageRegistrationResolver,
  ShikiThemeRegistrationResolver,
} from './plugin'
export type {
  EditorShikiSyntaxScopeMapping,
  EditorShikiTheme,
  EditorShikiThemeColorMode,
  EditorShikiThemeSettingLike,
  EditorThemeToShikiThemeOptions,
} from './theme'
export type { ShikiThemeLike } from './theme-extract'
export type { VscodeThemeDefinition, VscodeThemeRegistration } from './vscode-themes'
export type { ShikiWorkerLanguageRegistration, ShikiWorkerThemeRegistration } from './workerTypes'
export type {
  ShikiHighlighterSessionOptions,
  ShikiPreloadRegistrations,
  ShikiResolvedRegistrations,
  ShikiThemeOptions,
  ShikiWorkerCacheSnapshot,
  ShikiWorkerLifecycleState,
  ShikiWorkerOwnerOptions,
  ShikiWorkerOwnerSnapshot,
} from './workerClient'
