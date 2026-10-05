import {
  filesystemPath,
  tabId,
  fileDocument,
  fileResource,
  documentKey,
} from '@/lib/documents/utils/identity'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '@singapore-editor/core/document'
import { vi } from 'vitest'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { Toaster } from '@workspace/ui/components/sonner'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConflictCompletionFixture } from '../../../../../test/factories/conflict-completion'
import { observeDiffEditors } from '../../../../../test/factories/diff-attachment'
import { Editor } from '@/features/editor/components/editor'
import { notifyChangedFilesystemConflict } from '@/features/workspace/state/event-conflict-adapter'
import { fetchFile } from '@/lib/file-server'

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

test('native Compare opens the retained source locally and returns to the same resolution and Undo owner', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' captured local')
  const toaster = renderWithProviders(<Toaster />, {
    application: f.application,
    queryClient: f.queryClient,
  })
  act(() => notifyChangedFilesystemConflict(f.path, f.remote, f.context))
  fireEvent.click(await toaster.findByRole('button', { name: 'Compare' }))
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  const seed = conflict.seed!
  const resolution = f.documents.getLiveEditorDocument(seed.resolutionKey)!
  const id = tabId('local-conflict-capture')
  const view = f.documents.ensureEditorViewForDocument(id, seed.resolutionKey)
  const document: EditorRenderDocument = {
    key: seed.resolutionKey,
    target: resolution.target,
    buffer: resolution.buffer,
    view: view.view,
    analysis: resolution.analysis,
    editability: 'editable',
  }
  const captureSource = vi.fn()
  const observed = observeDiffEditors()
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <Editor
        active
        document={document}
        target={resolution.target}
        rootPath={filesystemPath('')}
        tabId={id}
        onCaptureSourceChange={captureSource}
        onStatusSourceChange={f.editor.uiStore.getState().setStatusBarSource}
      />
    </EditorStateProvider>,
    { application: f.application, queryClient: f.queryClient },
  )
  const controller = f.editor.uiStore.getState().controllersByTabId.get(id)!
  const original = resolution.buffer.materializeFullText()
  expect(original).toContain('<<<<<<<')
  act(() => createEditorBufferSession(resolution.buffer, view.view).applyText('note\n'))
  const edited = resolution.buffer.materializeFullText()
  act(() => controller.commands.setSelection(edited.indexOf('<<<<<<<'), edited.indexOf('<<<<<<<')))
  const selection = view.view.getSelections()
  act(() => expect(controller.commands.dispatchCommand('merge-conflict.compare')).toBe(true))
  expect(await rendered.findByRole('button', { name: 'Original comparison' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(f.editor.uiStore.getState().controllersByTabId.has(id)).toBe(false)
  expect(f.editor.uiStore.getState().statusBarSource).toBeNull()
  expect(captureSource.mock.calls.at(-1)?.[0]).toBeNull()
  await waitFor(() => expect(controller.getEditor()).toBeNull())
  await waitFor(() => expect(observed.all()).toHaveLength(1))
  expect(observed.all()[0]?.editor.getState().editability).toBe('readonly')
  expect(f.documents.getLiveEditorDocument(seed.resolutionKey)?.buffer).toBe(seed.buffer)
  expect(resolution.buffer.materializeFullText()).toBe(edited)
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(3)
  await writeFile(join(server.root, f.path), 'latest incoming')
  const incoming = await fetchFile(f.path, new AbortController().signal, f.context.client)
  act(() => notifyChangedFilesystemConflict(f.path, incoming, f.context))
  const latest = f.editor.conflictStore.getState().conflicts[conflict.id]!
  expect(latest.seed).toBe(seed)
  expect(latest.latest.input.capture.incoming).toMatchObject({ kind: 'text', file: incoming })
  fireEvent.click(rendered.getByRole('button', { name: 'Latest incoming' }))
  await waitFor(() =>
    expect(observed.all()[0]?.editor.materializeFullText()).toContain('latest incoming'),
  )
  fireEvent.click(rendered.getByRole('button', { name: 'Original comparison' }))
  await waitFor(() =>
    expect(observed.all()[0]?.editor.materializeFullText()).not.toContain('latest incoming'),
  )
  fireEvent.click(rendered.getByRole('button', { name: 'Resolution' }))
  await waitFor(() => expect(f.editor.uiStore.getState().controllersByTabId.has(id)).toBe(true))
  const returned = f.editor.uiStore.getState().controllersByTabId.get(id)!
  expect(returned.getEditor()?.materializeFullText()).toBe(edited)
  expect(globalThis.document.activeElement).toBe(returned.getEditor()?.getInputElement())
  expect(resolution.buffer).toBe(seed.buffer)
  expect(view.view.getSelections()).toEqual(selection)
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(2)
  act(() => expect(returned.commands.dispatchCommand('undo')).toBe(true))
  expect(resolution.buffer.materializeFullText()).toBe(original)
  act(() => {
    returned.commands.setSelection(0, 0)
    expect(returned.commands.dispatchCommand('merge-conflict.compare')).toBe(true)
  })
  expect(rendered.getByRole('button', { name: 'Original comparison' })).toBeVisible()
  act(() => f.editor.conflictStore.getState().clearConflicts())
  expect(rendered.queryByRole('button', { name: 'Original comparison' })).toBeNull()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
  expect(f.editor.uiStore.getState().controllersByTabId.has(id)).toBe(true)
  expect(resolution.buffer.materializeFullText()).toBe(original)
  rendered.unmount()
  toaster.unmount()
  f.editor.conflictStore.getState().clearConflicts()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('native Compare refuses a different logical target and a replacement resolution buffer incarnation', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' local')
  const toaster = renderWithProviders(<Toaster />, {
    application: f.application,
    queryClient: f.queryClient,
  })
  act(() => notifyChangedFilesystemConflict(f.path, f.remote, f.context))
  fireEvent.click(await toaster.findByRole('button', { name: 'Compare' }))
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  const seed = conflict.seed!
  const resolution = f.documents.getLiveEditorDocument(seed.resolutionKey)!
  const id = tabId('incarnation-guard')
  const originalView = f.documents.ensureEditorViewForDocument(id, seed.resolutionKey)
  const originalDocument: EditorRenderDocument = {
    key: seed.resolutionKey,
    target: resolution.target,
    buffer: resolution.buffer,
    view: originalView.view,
    analysis: resolution.analysis,
    editability: 'editable',
  }
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <Editor
        active
        document={originalDocument}
        target={fileDocument(fileResource(f.path))}
        rootPath={filesystemPath('')}
        tabId={id}
      />
    </EditorStateProvider>,
    { application: f.application, queryClient: f.queryClient },
  )
  const controller = f.editor.uiStore.getState().controllersByTabId.get(id)!
  act(() => expect(controller.commands.dispatchCommand('merge-conflict.compare')).toBe(false))
  expect(rendered.queryByRole('button', { name: 'Original comparison' })).toBeNull()
  const text = resolution.buffer.materializeFullText()
  const resolutionTarget = resolution.target
  if (resolutionTarget.kind !== 'conflict') throw new RangeError('Actual conflict target required')
  act(() => f.documents.deleteLiveEditorDocument(seed.resolutionKey))
  const replacement = f.documents.ensureUnsyncedEditorDocument({
    target: resolutionTarget,
    content: text,
  })
  const replacementView = f.documents.ensureEditorViewForDocument(id, seed.resolutionKey)
  expect(replacement.buffer).not.toBe(seed.buffer)
  const replacementDocument: EditorRenderDocument = {
    key: seed.resolutionKey,
    target: replacement.target,
    buffer: replacement.buffer,
    view: replacementView.view,
    analysis: replacement.analysis,
    editability: 'editable',
  }
  rendered.rerender(
    <EditorStateProvider>
      <Editor
        active
        document={replacementDocument}
        target={replacement.target}
        rootPath={filesystemPath('')}
        tabId={id}
      />
    </EditorStateProvider>,
  )
  const current = f.editor.uiStore.getState().controllersByTabId.get(id)!
  act(() => expect(current.commands.dispatchCommand('merge-conflict.compare')).toBe(false))
  expect(rendered.queryByRole('button', { name: 'Original comparison' })).toBeNull()
  expect(f.editor.conflictStore.getState().conflicts[conflict.id]?.seed).toBe(seed)
  expect(replacement.buffer.materializeFullText()).toBe(text)
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(2)
  rendered.unmount()
  toaster.unmount()
  f.editor.conflictStore.getState().clearConflicts()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
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
          readError={null}
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
    showFile: vi.fn(),
    openDefinition: vi.fn(),
    openReferences: vi.fn(),
    previewReference: vi.fn(),
    setScrollPosition,
    setStatusSource: vi.fn(),
  }
}
