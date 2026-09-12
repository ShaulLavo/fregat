import {
  filesystemPath,
  tabId,
  fileDocument,
  fileResource,
  documentKey,
} from '@/lib/documents/utils/identity'
import { createEditorTextBuffer, createEditorViewSession } from '@singapor/core'
import { vi } from 'vitest'

import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { FileEditorBody } from '@/features/workbench/components/file-editor-body'
import {
  EditorSurfaceActionsContext,
  type EditorSurfaceActions,
} from '@/features/workbench/providers/editor-surface-actions-context'
import { expect, test } from '../../../../../test/fixtures'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { renderWithProviders } from '../../../../../test/render'

test('an outgoing document cannot publish its scroll position into the incoming tab', () => {
  stubHighlightApi()
  const outgoing = editorDocument('/repo/a.ts', 200, 1_962)
  const incoming = editorDocument('/repo/b.ts', 4, 0)
  const outgoingScroll = vi.fn<EditorSurfaceActions['setScrollPosition']>()
  const outgoingActions = editorActions(outgoingScroll)
  const incomingScroll = vi.fn((position) => incoming.view.setScrollPosition(position))
  const incomingActions = editorActions(incomingScroll)
  const rendered = renderWithProviders(
    <EditorStateProvider>
      {body({ actions: outgoingActions, document: outgoing, path: '/repo/a.ts', tabId: 'tab-a' })}
    </EditorStateProvider>,
  )

  rendered.rerender(
    <EditorStateProvider>
      {body({ actions: incomingActions, document: null, path: '/repo/b.ts', tabId: 'tab-b' })}
    </EditorStateProvider>,
  )
  const outgoingPosition = outgoingScroll.mock.calls.at(-1)?.[0]
  expect(outgoingPosition).toBeDefined()

  rendered.rerender(
    <EditorStateProvider>
      {body({ actions: incomingActions, document: incoming, path: '/repo/b.ts', tabId: 'tab-b' })}
    </EditorStateProvider>,
  )

  expect(incomingScroll).not.toHaveBeenCalledWith(outgoingPosition)
  expect(incoming.view.getScrollPosition()).not.toEqual(outgoingPosition)
})

function body({
  actions,
  document,
  path,
  tabId: id,
}: {
  actions: EditorSurfaceActions
  document: EditorRenderDocument | null
  path: string
  tabId: string
}) {
  return (
    <EditorSurfaceActionsContext value={actions}>
      <div data-workbench>
        <FileEditorBody
          active={false}
          definitionTarget={null}
          fileState={{ status: 'loading' }}
          fileVersion={null}
          languageServerReferences={null}
          liveDocument={document}
          target={fileDocument(fileResource(filesystemPath(path)))}
          rootPath={filesystemPath('/repo')}
          tabId={tabId(id)}
        />
      </div>
    </EditorSurfaceActionsContext>
  )
}

function editorDocument(path: string, lines: number, scrollTop: number): EditorRenderDocument {
  const buffer = createEditorTextBuffer(
    Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n'),
  )
  const view = createEditorViewSession(buffer, `view:${path}`)
  view.setScrollPosition({ left: 0, top: scrollTop })
  const target = fileDocument(fileResource(filesystemPath(path)))
  return { buffer, editability: 'editable', key: documentKey(target), target, view }
}

function editorActions(
  setScrollPosition: EditorSurfaceActions['setScrollPosition'] = vi.fn(),
): EditorSurfaceActions {
  return {
    applyWorkspaceEdit: vi.fn(),
    closeReferences: vi.fn(),
    handleTextChange: vi.fn(),
    openDefinition: vi.fn(),
    openReferences: vi.fn(),
    previewReference: vi.fn(),
    setScrollPosition,
    setStatusSource: vi.fn(),
  }
}
