export { createHighlightingPlugin } from './plugin'
export type { HighlightingPluginOptions } from './plugin'
export { createHighlightingService, HighlightingError } from './service'
export type {
  HighlightOptions,
  HighlightResult,
  HighlightingDocumentBackend,
  HighlightingLanguage,
  HighlightingService,
  HighlightingServiceOptions,
  HighlightingServiceSnapshot,
  HighlightingThemeSelection,
  HighlightingThemeSource,
} from './service'
export { highlightingGrammar, HIGHLIGHTING_DOCUMENT_LANGUAGES } from './languages'
export { resolveHighlightTheme } from './theme'
export type { HighlightTheme, ResolvedHighlightTheme } from './theme'
