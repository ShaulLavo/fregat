import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '@singapore-editor/core/editor'
import {
  acquireDocumentMutationLease,
  createEditorBufferSession,
  releaseDocumentMutationLease,
} from '@singapore-editor/core/document'
import {
  applyBatchToPieceTable,
  materializePieceTableFullText,
  retainPieceTableSnapshot,
  type PieceTableEdit,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { EditorRoom } from './editor-fixture'

let room: EditorRoom | undefined
let shared: Editor | undefined

afterEach(() => {
  shared?.dispose()
  shared = undefined
  room?.dispose()
  room = undefined
  document.body.replaceChildren()
})

test('detachment during a lease retains confirmed text and coherent native history', async () => {
  room = new EditorRoom(2, 'seed')
  const editor = room.editors[1]!
  const buffer = editor.getBufferSession()!.buffer
  const before = buffer.getSnapshot()
  const publications: {
    before: PieceTableSnapshot
    after: PieceTableSnapshot
    edits: readonly PieceTableEdit[]
  }[] = []
  buffer.subscribe((event) => {
    if (
      event.textSnapshotBefore.materializeFullText() ===
      event.change.textSnapshot.materializeFullText()
    )
      return
    publications.push({
      before: event.textSnapshotBefore.snapshot,
      after: event.change.snapshot,
      edits: event.change.edits,
    })
  })
  const lease = acquireDocumentMutationLease(buffer, buffer.getRevision(), before, 'lease-detach')
  expect(lease.status).toBe('acquired')
  if (lease.status !== 'acquired') return
  try {
    room.editors[0]!.edit({ from: 4, to: 4, text: 'remote' })
    room.flush()
    expect(room.connections[1]!.document.engine.text()).toBe('seedremote')
    expect(editor.materializeFullText()).toBe('seed')
    editor.setPlugins([])
    expect(editor.materializeFullText()).toBe('seed')
  } finally {
    releaseDocumentMutationLease(buffer, lease.lease)
  }
  expect(editor.materializeFullText()).toBe('seedremote')
  expect(buffer.getSnapshot().charIds).toBeNull()
  expect(publications.map(({ edits }) => edits)).toEqual([[{ from: 4, to: 4, text: 'remote' }]])
  expect(buffer.getHistoryGraph().nodes).toHaveLength(1)
  expect(editor.getState().canUndo).toBe(false)
  expect(editor.getState().canRedo).toBe(false)
  editor.edit({ from: 10, to: 10, text: 'local' })
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('seedremote')
  editor.dispatchCommand('redo')
  expect(editor.materializeFullText()).toBe('seedremotelocal')
  for (const publication of publications) {
    expect(
      materializePieceTableFullText(
        applyBatchToPieceTable(
          { ...retainPieceTableSnapshot(publication.before), charIds: null },
          publication.edits,
        ),
      ),
    ).toBe(materializePieceTableFullText(publication.after))
  }
  await commands.editorLook('lease-detach-preserved')
})

test('an unbound view executes the shared buffer selective Undo and Redo', async () => {
  room = new EditorRoom(2, 'seed')
  const element = document.createElement('div')
  element.style.cssText = 'flex:1;min-width:0;height:100%;'
  room.host.append(element)
  shared = new Editor(element)
  shared.attachSession(createEditorBufferSession(room.editors[0]!.getBufferSession()!.buffer))
  expect(shared.getState().canUndo).toBe(false)
  expect(shared.getState().canRedo).toBe(false)
  shared.edit({ from: 4, to: 4, text: 'shared' })
  room.flush()
  room.editors[1]!.edit({ from: 10, to: 10, text: 'remote' })
  room.flush()
  expect(shared.getState().canUndo).toBe(true)
  shared.dispatchCommand('undo')
  room.flush()
  expect(shared.materializeFullText()).toBe('seedremote')
  expect(room.texts()).toEqual(['seedremote', 'seedremote'])
  expect(shared.getState().canUndo).toBe(false)
  expect(shared.getState().canRedo).toBe(true)
  expect(room.editors[0]!.getState().canRedo).toBe(true)
  shared.dispatchCommand('redo')
  room.flush()
  expect(shared.materializeFullText()).toBe('seedsharedremote')
  expect(room.texts()).toEqual(['seedsharedremote', 'seedsharedremote'])
  expect(shared.getState().canUndo).toBe(true)
  expect(shared.getState().canRedo).toBe(false)
  await commands.editorLook('shared-view-history')
})
