import { act, renderHook } from '@testing-library/react'
import { describe, vi } from 'vitest'
import { test, expect } from '../../../../../test/fixtures'
import { createWorkspaceTextChanges } from '../../../../../test/factories/workspace-text-changes'
import { WorkspaceEditHostContext } from '@/lib/workspace-edits/providers/host-context'
import { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin/document-sync-controller'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { useLanguageServerPlugin } from '@/features/editor/hooks/use-lsp-plugin'
import { createMatchedLanguageServerPlugin } from '@/features/editor/utils/language-server-plugin'

const dependencies = vi.hoisted(() => ({
  runtime: {} as {
    documentStore: ReturnType<typeof createEditorDocumentStore>
    languageServerDocuments: { setLimit: (limit: number) => void }
  },
  configuration: { generation: 1 },
  fileOpenIntent: { service: { prepare: vi.fn() } },
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
vi.mock('@/lib/diagnostic-ai/hooks/use-diagnostic-fix', () => ({
  useDiagnosticFix: () => ({ available: true, mutation: { mutateAsync: dependencies.apply } }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => null,
}))
vi.mock('@/features/editor/hooks/use-document-feature-tier', () => ({
  useDocumentFeatureTier: () => ({
    analysisAllowed: true,
    analysisLimitMiCodeUnits: 10,
    minimapAllowed: true,
  }),
}))
vi.mock('@/lib/environments/state/query-clients', () => ({
  originForQueryClient: () => 'http://localhost:3001',
}))
vi.mock('@/features/editor/utils/language-server-plugin', () => ({
  createMatchedLanguageServerPlugin: vi.fn(() => ({ name: 'test-lsp', activate: () => [] })),
}))

describe('useLanguageServerPlugin', () => {
  test('replaces the plugin when its buffer is replaced, but retains it for edits and other files', ({
    client,
  }) => {
    const { service } = createWorkspaceTextChanges(client)
    const host = {
      documentSyncController: new LanguageServerDocumentSyncController(),
      isOwnEvent: service.isOwnEvent,
      onApplyWorkspaceEdit: service.onApplyWorkspaceEdit,
    }
    const store = createEditorDocumentStore()
    dependencies.runtime = { documentStore: store, languageServerDocuments: { setLimit: vi.fn() } }
    const path = filesystemPath('/repo/a.ts')
    const file = { path, content: 'const value = 1', version: 'v1', mtimeMs: 1, size: 15 }
    const firstDocument = store.getState().ensureLiveEditorDocument(file)
    const options = {
      document: { key: fileDocumentKey(path), uri: 'file:///repo/a.ts' },
      filePath: path,
      rootPath: '/repo',
    }
    const { result, unmount } = renderHook(() => useLanguageServerPlugin(options), {
      wrapper: ({ children }) => (
        <WorkspaceEditHostContext value={host}>{children}</WorkspaceEditHostContext>
      ),
    })
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
