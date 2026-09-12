import { filesystemPath } from '@/lib/documents/utils/identity'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import {
  createEditorDocumentStore,
  EditorDocumentStateContext,
} from '@/features/editor/state/document-state'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { expect, test } from '../../../../../test/fixtures'

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
  store.getState().ensureLiveEditorDocument({
    content: 'const value = 1\n',
    mtimeMs: 1,
    path: filesystemPath('/repo/a.ts'),
    size: 16,
    version: 'v1',
  })
  const wrapper = ({ children }: { readonly children: ReactNode }) =>
    createElement(EditorDocumentStateContext.Provider, { value: store }, children)

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
})
