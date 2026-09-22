import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { useLanguageServerPlugin } from '@/features/editor/hooks/use-lsp-plugin'
import { createMatchedLanguageServerPlugin } from '@/features/editor/utils/language-server-plugin'

const dependencies = vi.hoisted(() => ({
  runtime: {} as { documentStore: ReturnType<typeof createEditorDocumentStore> },
  configuration: { generation: 1 },
  fileOpenIntent: { service: { prepare: vi.fn() } },
  controller: {},
  apply: vi.fn(),
  matches: [],
}))
vi.mock('@/features/editor/hooks/use-runtime', () => ({
  useEditorRuntime: () => dependencies.runtime,
}))
vi.mock('@/features/editor/providers/language-server-match-context', () => ({
  useLanguageServerMatchConfiguration: () => dependencies.configuration,
}))
vi.mock('@/features/editor/hooks/use-language-server-matches', () => ({
  useLanguageServerMatches: () => dependencies.matches,
}))
vi.mock('@/lib/file-open-intent/providers/context', () => ({
  useFileOpenIntent: () => dependencies.fileOpenIntent,
}))
vi.mock('@/features/editor/providers/workspace-edit-context', () => ({
  useWorkspaceDocumentSyncController: () => dependencies.controller,
  useWorkspaceEditHost: () => dependencies.apply,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => null }))
vi.mock('@/lib/environments/state/query-clients', () => ({
  originForQueryClient: () => 'http://localhost:3001',
}))
vi.mock('@/features/editor/utils/language-server-plugin', () => ({
  createMatchedLanguageServerPlugin: vi.fn(() => ({ name: 'test-lsp', activate: () => [] })),
}))

describe('useLanguageServerPlugin', () => {
  it('replaces the plugin when its buffer is replaced, but retains it for edits and other files', () => {
    const store = createEditorDocumentStore()
    dependencies.runtime = { documentStore: store }
    const path = filesystemPath('/repo/a.ts')
    const file = { path, content: 'const value = 1', version: 'v1', mtimeMs: 1, size: 15 }
    const firstDocument = store.getState().ensureLiveEditorDocument(file)
    const options = {
      document: { key: fileDocumentKey(path), uri: 'file:///repo/a.ts' },
      filePath: path,
      rootPath: '/repo',
    }
    const { result, unmount } = renderHook(() => useLanguageServerPlugin(options))
    const firstPlugin = result.current.languageServer
    act(() => {
      store
        .getState()
        .ensureLiveEditorDocument({ ...file, content: 'const value = 2', version: 'v2' })
    })
    const replacement = store.getState().liveDocumentsByKey[fileDocumentKey(path)]!
    expect(replacement.buffer).not.toBe(firstDocument.buffer)
    expect(result.current.languageServer).not.toBe(firstPlugin)
    expect(vi.mocked(createMatchedLanguageServerPlugin).mock.lastCall?.[0].buffer).toBe(
      replacement.buffer,
    )
    const replacementPlugin = result.current.languageServer
    act(() => {
      const session = createEditorBufferSession(replacement.buffer)
      session.applyEdits([{ from: 0, to: 0, text: '// edit\n' }])
      store.getState().ensureLiveEditorDocument({ ...file, path: filesystemPath('/repo/b.ts') })
    })
    expect(result.current.languageServer).toBe(replacementPlugin)
    unmount()
  })
})
