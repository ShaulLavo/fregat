import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { act, renderHook } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createTextDiff } from '@singapore-editor/diff'
import { QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import { diffLanguageDocuments } from '@/features/editor/utils/diff-documents'
import {
  createEditorDocumentStore,
  EditorDocumentStateContext,
} from '@/features/editor/state/document-state'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient } from '../../../../../test/render'

test('fails loudly when Platform document state is absent', () => {
  expect(() =>
    renderHook(() =>
      useDiffLanguageContext(
        filesystemPath('/repo/a.ts'),
        filesystemPath('/repo'),
        true,
        testDiffLanguageHost,
      ),
    ),
  ).toThrow('useEditorDocumentStoreApi must be used within EditorStateProvider')
})

test('publishes live Platform text and explicit host capabilities', () => {
  const store = createEditorDocumentStore()
  const document = store.getState().ensureLiveEditorDocument({
    content: 'const value = 1\n',
    mtimeMs: 1,
    path: filesystemPath('/repo/a.ts'),
    size: 16,
    version: 'v1',
  })
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { readonly children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(EditorDocumentStateContext.Provider, { value: store }, children),
    )

  const { result } = renderHook(
    () =>
      useDiffLanguageContext(
        filesystemPath('a.ts'),
        filesystemPath('/repo'),
        true,
        testDiffLanguageHost,
      ),
    { wrapper },
  )

  expect(result.current).toMatchObject({
    documentPath: '/repo/a.ts',
    host: testDiffLanguageHost,
    newSideIsWorkingTree: true,
    ownedText: 'const value = 1\n',
    rootPath: '/repo',
  })

  const file = createTextDiff({
    oldFile: { path: '/repo/a.ts', text: 'const value = 0\n' },
    newFile: { path: '/repo/a.ts', text: 'const value = 1\n' },
  })
  const snapshot = document.buffer.getTextSnapshot()
  expect(diffLanguageDocuments({ ...result.current!, file })[0]?.sharesRealUri).toBe(true)
  act(() => {
    createEditorBufferSession(document.buffer).applyEdits([{ from: 14, to: 15, text: '2' }])
  })
  expect(document.buffer.materializeFullText()).toBe('const value = 2\n')
  expect(
    store.getState().liveDocumentsByKey[fileDocumentKey(filesystemPath('/repo/a.ts'))]?.buffer,
  ).toBe(document.buffer)
  expect(document.buffer.getTextSnapshot()).not.toBe(snapshot)
  expect(result.current?.ownedText).toBe('const value = 2\n')
  expect(diffLanguageDocuments({ ...result.current!, file })[0]?.sharesRealUri).toBe(false)
})
