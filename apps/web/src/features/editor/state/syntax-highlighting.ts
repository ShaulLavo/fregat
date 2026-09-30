import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import type { DiffSyntaxBackend } from '@singapore-editor/diff'
import type {
  HighlightingThemeSelection,
  HighlightingThemeSource,
} from '@singapore-editor/highlighting'
import type { TreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'

import {
  activeEditorThemeUsesShiki,
  activeShikiThemeId,
  subscribeActiveShikiTheme,
} from '@/features/editor/state/color-theme-store'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'
import { isBuiltinEditorThemeId } from '@/lib/code-theme/utils/catalog'
import { disposeHighlightingService, highlightingService } from '@/lib/highlighting/state/service'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'

/** Which palette colors documents: an imported theme, the editor palette, or nothing. */
export type EditorSyntaxColors = 'disabled' | HighlightingThemeSelection['format']

export type EditorDiffSyntax = {
  readonly backend: DiffSyntaxBackend
  /** The palette prepared diff syntax is kept under; null while highlighting is off. */
  readonly theme: HighlightingThemeSource | null
}

/** The active palette: an imported theme colors documents, a built-in one leaves it to captures. */
export const EDITOR_THEME_SOURCE: HighlightingThemeSource = {
  current: () =>
    activeEditorThemeUsesShiki()
      ? { format: 'vscode', id: activeShikiThemeId() }
      : { format: 'editor' },
  subscribe: subscribeActiveShikiTheme,
  importedFallback: activeShikiThemeId,
}

// Markdown structure and colors share one document parser.
export const EDITOR_PALETTE_SOURCE: HighlightingThemeSource = {
  current: () => ({ format: 'editor' }),
}

/** Markdown structure and colors share one document parser. */
export function editorSyntaxColors(
  selectedThemeId?: string,
  languageId?: string | null,
): EditorSyntaxColors {
  if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) return 'disabled'
  if (editorPerformanceFeatureDisabled('syntax')) return 'disabled'
  if (languageId === 'markdown' || languageId === 'mdx') return 'editor'

  const imported = selectedThemeId
    ? !isBuiltinEditorThemeId(selectedThemeId)
    : activeEditorThemeUsesShiki()
  return imported ? 'vscode' : 'editor'
}

/** The theme source documents under these colors take their providers from. */
export function editorSyntaxTheme(colors: EditorSyntaxColors): HighlightingThemeSource | null {
  if (colors === 'disabled') return null
  return colors === 'vscode' ? EDITOR_THEME_SOURCE : EDITOR_PALETTE_SOURCE
}

export function editorDiffSyntax(colors: EditorSyntaxColors): EditorDiffSyntax {
  const theme = editorSyntaxTheme(colors)
  if (!theme) return { backend: { kind: 'tree-sitter', provider: null }, theme }

  return { backend: highlightingService().documentBackend(theme), theme }
}

export function editorHighlighterProvider(): EditorHighlighterProvider {
  return highlightingService().highlighterProvider(EDITOR_THEME_SOURCE)
}

export function editorSyntaxProvider(): TreeSitterSyntaxProvider {
  return highlightingService().syntaxProvider()
}

/** Stops the workers along with the diff parses kept on their sessions. */
export function disposeEditorSyntaxHighlighting(): Promise<void> {
  return disposeHighlightingService()
}

export function awaitEditorSyntaxWorkerIdleFences(): Promise<void> {
  return highlightingService().awaitIdle()
}

export function awaitEditorSyntaxRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
  return highlightingService().awaitRuntimeSessionIdle(runtimeSessionId)
}
