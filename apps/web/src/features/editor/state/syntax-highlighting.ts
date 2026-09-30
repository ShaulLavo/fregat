import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import type { DiffSyntaxBackend } from '@singapore-editor/diff'
import type { HighlightingThemeSource } from '@singapore-editor/highlighting'
import type { TreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'

import { clearPreparedDiffSyntax } from '@/features/editor/state/prepared-diff-syntax'
import {
  activeEditorThemeUsesShiki,
  activeShikiThemeId,
  subscribeActiveShikiTheme,
} from '@/features/editor/state/color-theme-store'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'
import { isBuiltinEditorThemeId } from '@/lib/code-theme/utils/catalog'
import { disposeHighlightingService, highlightingService } from '@/lib/highlighting/state/service'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'

export type EditorSyntaxHighlightingSource = 'disabled' | 'shiki' | 'tree-sitter'

export type EditorDiffSyntaxConfiguration = {
  readonly backend: DiffSyntaxBackend
  readonly enabled: boolean
  readonly source: EditorSyntaxHighlightingSource
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
export function editorSyntaxHighlightingSource(
  selectedThemeId?: string,
  languageId?: string | null,
): EditorSyntaxHighlightingSource {
  if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) return 'disabled'
  if (editorPerformanceFeatureDisabled('syntax')) return 'disabled'
  if (languageId === 'markdown' || languageId === 'mdx') return 'tree-sitter'

  const usesShiki = selectedThemeId
    ? !isBuiltinEditorThemeId(selectedThemeId)
    : activeEditorThemeUsesShiki()
  return usesShiki ? 'shiki' : 'tree-sitter'
}

export function editorDiffSyntaxConfiguration(
  source: EditorSyntaxHighlightingSource,
): EditorDiffSyntaxConfiguration {
  if (source === 'disabled') {
    return {
      backend: { kind: 'tree-sitter', provider: null },
      enabled: false,
      source,
    }
  }

  const theme = source === 'shiki' ? EDITOR_THEME_SOURCE : EDITOR_PALETTE_SOURCE
  const backend =
    source === 'shiki'
      ? { kind: 'highlighter' as const, provider: highlightingService().highlighterProvider(theme) }
      : highlightingService().documentBackend(theme)
  return { backend, enabled: true, source }
}

export function editorShikiHighlighterProvider(): EditorHighlighterProvider {
  return highlightingService().highlighterProvider(EDITOR_THEME_SOURCE)
}

export function editorTreeSitterSyntaxProvider(): TreeSitterSyntaxProvider {
  return highlightingService().syntaxProvider()
}

/** Drops kept diff parses with the workers that hold their sessions. */
export async function disposeEditorSyntaxHighlighting(): Promise<void> {
  clearPreparedDiffSyntax('shiki')
  clearPreparedDiffSyntax('tree-sitter')
  await disposeHighlightingService()
}

export function awaitEditorSyntaxWorkerIdleFences(): Promise<void> {
  return highlightingService().awaitIdle()
}

export function awaitEditorSyntaxRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
  return highlightingService().awaitRuntimeSessionIdle(runtimeSessionId)
}
