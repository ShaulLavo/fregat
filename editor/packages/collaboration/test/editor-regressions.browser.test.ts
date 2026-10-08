import { afterEach, expect, test } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import { applyBatchToPieceTable, materializePieceTableFullText } from '@singapore-editor/textbuffer'
import {
  createEditorBufferSession,
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  prepareDocumentTransaction,
} from '@singapore-editor/core/document'
import { CollaborationDocument } from '../src/document'
import { createCollaborationPlugin } from '../src/plugin'
import { EditorRoom } from './editor-fixture'
let room: EditorRoom | undefined
const standalone: Editor[] = []
afterEach(() => {
  room?.dispose()
  room = undefined
  for (const editor of standalone.splice(0)) editor.dispose()
  document.body.replaceChildren()
})
const text = (editor: Editor) => editor.getTextSnapshot().materializeFullText()
function mount(initial: string) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor(element, { defaultText: initial })
  standalone.push(editor)
  return editor
}

test('review: adversarial author A undo preserves B typing inside A text', () => {
  room = new EditorRoom(2, 'seed')
  room.editors[0]!.edit({ from: 4, to: 4, text: 'AX' })
  room.flush()
  room.editors[1]!.edit({ from: 5, to: 5, text: 'b' })
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.texts()).toEqual(['seedb', 'seedb'])
  room.editors[0]!.dispatchCommand('redo')
  room.flush()
  expect(room.texts()).toEqual(['seedAbX', 'seedAbX'])
})

test('review: multi-cursor batch converges and undoes once', () => {
  room = new EditorRoom(2, 'abcd')
  room.editors[0]!.edit([
    { from: 0, to: 0, text: 'X' },
    { from: 4, to: 4, text: 'Y' },
  ])
  room.flush()
  expect(room.texts()).toEqual(['XabcdY', 'XabcdY'])
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.texts()).toEqual(['abcd', 'abcd'])
})

test('review: anonymous setText replacement survives', () => {
  room = new EditorRoom(2, 'old')
  room.editors[0]!.setText('new')
  expect(text(room.editors[0]!)).toBe('new')
})

test('review: same-start insertion and replacement matches ordinary editor', () => {
  room = new EditorRoom(2, 'ab')
  const native = mount('ab')
  const edits = [
    { from: 0, to: 0, text: 'X' },
    { from: 0, to: 1, text: 'Y' },
  ]
  native.edit(edits)
  room.editors[0]!.edit(edits)
  room.flush()
  expect(text(native)).toBe('XYb')
  expect(room.texts()).toEqual(['XYb', 'XYb'])
})

test('review: failed batch is atomic in participant and editor', () => {
  room = new EditorRoom(2, '😀ab')
  expect(() =>
    room!.editors[0]!.edit([
      { from: 4, to: 4, text: 'X' },
      { from: 1, to: 2, text: '\ud800' },
    ]),
  ).toThrow()
  expect(text(room.editors[0]!)).toBe('😀ab')
  expect(room.connections[0]!.document.engine.text()).toBe('😀ab')
  expect(room.connections[0]!.document.participant.state().pending).toEqual([])
  expect(room.connections[0]!.document.participant.undoManager.state().undo).toEqual([])
  room.editors[0]!.edit({ from: 4, to: 4, text: 'ok' })
  room.flush()
  expect(room.texts()).toEqual(['😀abok', '😀abok'])
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.texts()).toEqual(['😀ab', '😀ab'])
})

test('review: syncText supports valid emoji replacement', () => {
  room = new EditorRoom(2, '😀')
  expect(() => room!.editors[0]!.syncText('😁')).not.toThrow()
  room.flush()
  expect(room.texts()).toEqual(['😁', '😁'])
})

test('review: native undo after detachment publishes matching inverse and preserves remote insertion', () => {
  const editor = mount('seed')
  editor.edit({ from: 4, to: 4, text: 'own' })
  let connection: import('../src/plugin').CollaborationConnection | undefined
  const plugin = createCollaborationPlugin({
    session: { peer: 'a', room: 'r', document: 'd', epoch: 'e', text: 'seedown' },
    transport: { send() {} },
    manualClock: true,
    onReady(c) {
      connection = c
    },
  })
  editor.addPlugin(plugin)
  const remote = new CollaborationDocument({
    peer: 'b',
    document: 'd',
    epoch: 'e',
    text: 'seedown',
  })
  connection!.document.apply(
    remote.sequence(remote.participant.local({ offset: 7, deleteCount: 0, text: 'remote' })),
  )
  expect(text(editor)).toBe('seedownremote')
  editor.removePlugin(plugin)
  const before = editor.getBufferSession()!.getSnapshot()
  let edits: readonly import('@singapore-editor/textbuffer').PieceTableEdit[] | undefined
  editor.getBufferSession()!.buffer.subscribe((event) => {
    if (event.change.kind === 'undo') edits = event.change.edits
  })
  editor.dispatchCommand('undo')
  if (edits)
    expect(materializePieceTableFullText(applyBatchToPieceTable(before, edits))).toBe(text(editor))
  expect(text(editor)).toBe('seedownremote')
  editor.dispatchCommand('redo')
  expect(text(editor)).toBe('seedownremote')
})

test('review: remote reconciliation survives mutation lease', () => {
  room = new EditorRoom(2, 'seed')
  const buffer = room.editors[1]!.getBufferSession()!.buffer
  const lease = acquireDocumentMutationLease(
    buffer,
    buffer.getRevision(),
    buffer.getSnapshot(),
    'review',
  )
  expect(lease.status).toBe('acquired')
  if (lease.status !== 'acquired') return
  room.editors[0]!.edit({ from: 4, to: 4, text: 'remote' })
  room.flush()
  releaseDocumentMutationLease(buffer, lease.lease)
  room.flush()
  expect(room.texts()).toEqual(['seedremote', 'seedremote'])
})

test.each([
  { from: 0, to: 1, text: '' },
  { from: 0, to: 0, text: 'new' },
])('prepared edit cannot silently bypass author: %j', (edit) => {
  room = new EditorRoom(2, 'seed')
  const session = room.editors[0]!.getBufferSession()!
  expect(() => prepareDocumentTransaction(session.buffer, [edit], 1, null)).toThrow(
    'authored documents require local edits or reconcile',
  )
  room.flush()
  expect(room.texts()).toEqual(['seed', 'seed'])
})

test('review: branch install retains origins before replaying pending dependent', () => {
  const losing = new CollaborationDocument({ peer: 'b', document: 'd', epoch: 'e', text: 'seed' })
  losing.sequence(losing.participant.local({ offset: 4, deleteCount: 0, text: 'A' }))
  losing.participant.local({ offset: 5, deleteCount: 0, text: 'B' })
  expect(() => losing.install([])).not.toThrow()
})

test('review: history skip is honored in collaborative undo', () => {
  room = new EditorRoom(2, 'seed')
  room.editors[0]!.edit({ from: 4, to: 4, text: 'skip' }, { history: 'skip' })
  room.flush()
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.texts()).toEqual(['seedskip', 'seedskip'])
})

test('review: public canUndo reflects selective history', () => {
  room = new EditorRoom(2, 'seed')
  room.editors[0]!.edit({ from: 4, to: 4, text: 'A' })
  room.flush()
  expect(room.editors[0]!.getState().canUndo).toBe(true)
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.editors[0]!.getState().canRedo).toBe(true)
})

test('review: session retains one confirmation object per edit, shared by tip histories', () => {
  room = new EditorRoom(1)
  for (let key = 0; key < 100; key++) {
    room.editors[0]!.edit({ from: key, to: key, text: 'a' })
    room.flush(1)
  }
  const histories = (room.connections[0]!.session as any).histories as Map<
    string,
    readonly object[]
  >
  const objects = new Set([...histories.values()].flat())
  console.log(
    'review history counts',
    JSON.stringify({ edits: 100, tips: histories.size, retainedRecords: objects.size }),
  )
  expect(objects.size).toBeLessThanOrEqual(100)
  expect(
    [...histories.values()].reduce((sum, history) => sum + history.length, 0),
  ).toBeLessThanOrEqual(100)
})

test('failed competing binding leaves the existing author and shared buffer unchanged', () => {
  room = new EditorRoom(1, 'seed')
  room.editors[0]!.edit({ from: 4, to: 4, text: 'live' })
  room.flush()
  const second = mount('seed')
  second.attachSession(createEditorBufferSession(room.editors[0]!.getBufferSession()!.buffer))
  let ready = false
  second.addPlugin(
    createCollaborationPlugin({
      session: {
        peer: 'fresh-peer',
        room: 'test-room',
        document: 'test-document',
        epoch: 'test-epoch',
        text: 'seed',
      },
      transport: { send() {} },
      manualClock: true,
      onReady() {
        ready = true
      },
    }),
  )
  expect(ready).toBe(false)
  expect(text(second)).toBe('seedlive')
  expect(room.texts()).toEqual(['seedlive'])
  room.editors[0]!.edit({ from: 8, to: 8, text: 'more' })
  room.flush()
  expect(text(second)).toBe('seedlivemore')
  expect(room.connections[0]!.document.engine.text()).toBe('seedlivemore')
})

test('a repaired surrogate seam within a batch remains a valid whole-pair edit', () => {
  room = new EditorRoom(2, '😀ab')
  room.editors[0]!.edit([
    { from: 4, to: 4, text: 'X' },
    { from: 1, to: 2, text: '\ude01' },
  ])
  room.flush()
  expect(room.texts()).toEqual(['😁abX', '😁abX'])
})

test('split rejoin recovers confirmed losing origins before mid-election typing', () => {
  room = new EditorRoom(2, 'seed')
  const a = room.connections[0]!.session
  const b = room.connections[1]!.session
  a.disconnect(b.peer)
  b.disconnect(a.peer)
  room.flush()
  room.editors[0]!.edit({ from: 4, to: 4, text: 'A' })
  room.flush()
  room.editors[1]!.edit({ from: 0, to: 0, text: 'X' })
  room.flush()
  room.editors[1]!.edit({ from: 0, to: 0, text: 'Y' })
  room.flush()
  a.connect(b.peer)
  b.connect(a.peer)
  room.editors[0]!.edit({ from: 5, to: 5, text: 'B' })
  room.flush()
  expect(room.texts()).toEqual(['YXseedAB', 'YXseedAB'])
  expect(room.connections[0]!.document.participant.state().pending).toEqual([])
  expect(room.connections[0]!.document.participant.state().blocked).toEqual([])
})

test('participant departure drains pending typing before closing its session', () => {
  room = new EditorRoom(2, 'seed')
  room.editors[1]!.edit({ from: 4, to: 4, text: 'departure' })
  room.connections[1]!.session.leave()
  room.flush()
  expect(room.connections[1]!.session.status).toBe('left')
  expect(room.texts()).toEqual(['seeddeparture', 'seeddeparture'])
})

test('detached native Undo and Redo use the merged text as their fresh base', () => {
  room = new EditorRoom(2, 'seed')
  room.editors[0]!.edit({ from: 4, to: 4, text: 'own' })
  room.flush()
  room.editors[1]!.edit({ from: 7, to: 7, text: 'remote' })
  room.flush()
  const editor = room.editors[0]!
  editor.setPlugins([])
  editor.edit({ from: 13, to: 13, text: 'native' })
  editor.dispatchCommand('undo')
  expect(text(editor)).toBe('seedownremote')
  editor.dispatchCommand('redo')
  expect(text(editor)).toBe('seedownremotenative')
})

test('same-start insertions keep their native order when both ranges are empty', () => {
  room = new EditorRoom(2, 'ab')
  const native = mount('ab')
  const edits = [
    { from: 0, to: 0, text: 'X' },
    { from: 0, to: 0, text: 'Z' },
  ]
  native.edit(edits)
  room.editors[0]!.edit(edits)
  room.flush()
  expect(text(native)).toBe('ZXab')
  expect(room.texts()).toEqual([text(native), text(native)])
})

test('constructor plugins retain authorship on the initialized default-text buffer', () => {
  room = new EditorRoom(2, 'seed')
  for (const [index, editor] of room.editors.entries()) {
    expect(editor.getBufferSession()!.getSnapshot()).toBe(
      room.connections[index]!.document.engine.snapshot().buffer,
    )
  }
  room.editors[0]!.edit({ from: 4, to: 4, text: 'live' })
  room.flush()
  expect(room.texts()).toEqual(['seedlive', 'seedlive'])
})
