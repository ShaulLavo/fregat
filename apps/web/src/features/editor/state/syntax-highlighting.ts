import type { EditorHighlighterProvider } from '@singapore-editor/core'
import {
  createShikiHighlighterProvider,
  createShikiWorkerOwner,
  type ShikiWorkerOwner,
} from '@singapore-editor/core/shiki'
import type { DiffSyntaxBackend } from '@singapore-editor/diff'
import {
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerBackend,
  type TreeSitterBackend,
  type TreeSitterSyntaxProvider,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'

import {
  activeEditorThemeUsesShiki,
  activeShikiThemeId,
  subscribeActiveShikiTheme,
  getResolvedShikiThemeContentHash,
  resolveEditorShikiThemeRegistration,
} from '@/features/editor/state/color-theme-store'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'
import {
  EDITOR_SHIKI_LANGUAGE_MAP,
  EDITOR_SHIKI_PRELOAD_LANGUAGES,
  resolveShikiLanguageRegistrations,
} from '@/features/editor/utils/shiki-languages'
import { isBuiltinEditorThemeId } from '@/lib/code-theme/utils/catalog'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { log } from '@/lib/client-logging'

let treeSitterSyntaxProvider: TreeSitterSyntaxProvider | null = null
let treeSitterSyntaxBackend: TreeSitterBackend | null = null
let shikiHighlighterProvider: EditorHighlighterProvider | null = null
let shikiWorkerOwner: ShikiWorkerOwner | null = null

export type EditorSyntaxHighlightingSource = 'disabled' | 'shiki' | 'tree-sitter'

export type EditorDiffSyntaxConfiguration = {
  readonly backend: DiffSyntaxBackend
  readonly enabled: boolean
  readonly source: EditorSyntaxHighlightingSource
}

/** The single policy used by regular documents and diffs. */
export function editorSyntaxHighlightingSource(
  selectedThemeId?: string,
): EditorSyntaxHighlightingSource {
  if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) return 'disabled'
  if (editorPerformanceFeatureDisabled('syntax')) return 'disabled'

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
  if (source === 'shiki') {
    return {
      backend: { kind: 'highlighter', provider: editorShikiHighlighterProvider() },
      enabled: true,
      source,
    }
  }

  return {
    backend: { kind: 'tree-sitter', provider: editorTreeSitterSyntaxProvider() },
    enabled: true,
    source,
  }
}

export function editorShikiHighlighterProvider(): EditorHighlighterProvider {
  if (shikiHighlighterProvider) return shikiHighlighterProvider

  shikiHighlighterProvider = createShikiHighlighterProvider({
    languages: EDITOR_SHIKI_LANGUAGE_MAP,
    preloadLanguages: EDITOR_SHIKI_PRELOAD_LANGUAGES,
    onThemeChanged: subscribeActiveShikiTheme,
    resolveLanguage: resolveShikiLanguageRegistrations,
    resolveTheme: resolveEditorShikiThemeRegistration,
    theme: resolveShikiThemeForSession,
    workerOwner: editorShikiWorkerOwner(),
  })
  return shikiHighlighterProvider
}

function editorShikiWorkerOwner(): ShikiWorkerOwner {
  if (shikiWorkerOwner) return shikiWorkerOwner

  shikiWorkerOwner = createShikiWorkerOwner()
  return shikiWorkerOwner
}

export async function disposeEditorShikiWorkerOwner() {
  const owner = shikiWorkerOwner
  shikiHighlighterProvider = null
  shikiWorkerOwner = null
  await owner?.dispose?.()
}

export function editorTreeSitterSyntaxProvider(): TreeSitterSyntaxProvider {
  if (treeSitterSyntaxProvider) return treeSitterSyntaxProvider

  const backend = createTreeSitterWorkerBackend()
  const provider = createTreeSitterSyntaxProvider({ backend })
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS) {
    provider.registerLanguage(contribution, { replace: true })
  }

  treeSitterSyntaxBackend = backend
  treeSitterSyntaxProvider = provider
  return provider
}

export async function disposeEditorTreeSitterSyntaxProvider() {
  const backend = treeSitterSyntaxBackend
  treeSitterSyntaxBackend = null
  treeSitterSyntaxProvider = null
  await backend?.dispose?.()
}

export async function awaitEditorSyntaxWorkerIdleFences(): Promise<void> {
  await Promise.all([
    treeSitterSyntaxBackend?.awaitIdleFence?.() ?? Promise.resolve(),
    shikiWorkerOwner?.awaitIdleFence() ?? Promise.resolve(),
  ])
}

export async function awaitEditorTreeSitterRuntimeSessionIdle(
  runtimeSessionId: string,
): Promise<void> {
  await treeSitterSyntaxBackend?.awaitRuntimeSessionIdle?.(runtimeSessionId)
}

export async function awaitEditorShikiRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
  await shikiWorkerOwner?.awaitRuntimeSessionIdle(runtimeSessionId)
}

/** Logs the exact theme handed to every shared Shiki session. */
function resolveShikiThemeForSession(): string {
  const themeId = activeShikiThemeId()
  log.debug({
    action: 'editor.color-theme.shiki_resolved',
    area: 'editor',
    contentHash: getResolvedShikiThemeContentHash(themeId),
    registrationOwner: 'app',
    themeId,
  })

  return themeId
}
