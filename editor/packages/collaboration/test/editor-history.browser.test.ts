// Singapore scenarios from docs/collab-editing/c-undo.md §5, grounded in E017/E018/E020.
import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import {
  createHistoryViewer,
  createEditorViewSession,
  resolveSelection,
} from '@singapore-editor/core/document'
import { charIdAt } from '@singapore-editor/textbuffer'
import { EditorRoom } from './editor-fixture'

let room: EditorRoom | undefined
afterEach(() => {
  room?.dispose()
  room = undefined
  document.body.replaceChildren()
})
const owner = () => room!.editors[0]!.getBufferSession()!
const offsets = (view: ReturnType<typeof createEditorViewSession>) => {
  const snapshot = owner().buffer.getSnapshot()
  return view.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(snapshot, selection)
    return [resolved.anchorOffset, resolved.headOffset]
  })
}

function insert(text: string): number {
  const { buffer } = owner()
  buffer.breakTypingRun()
  room!.editors[0]!.edit({
    from: buffer.getSnapshot().length,
    to: buffer.getSnapshot().length,
    text,
  })
  room!.flush()
  return buffer.getHistoryGraph().currentId
}

test('branch checkout retains remote edits and uses one host-ordered effect command', async () => {
  room = new EditorRoom(2, 'A')
  const b = insert('B')
  room.editors[0]!.dispatchCommand('undo')
  const c = insert('C')
  room.editors[1]!.edit({ from: 0, to: 0, text: 'R' })
  room.flush()
  expect(room.texts()).toEqual(['RAC', 'RAC'])
  const { buffer, view } = owner()
  expect(buffer.getHistoryGraph().nodes.map((node) => node.id)).toContain(b)
  expect(b).not.toBe(c)
  const depth = room.connections[0]!.document.checkpoint().depth
  const changes: string[] = []
  const stop = buffer.subscribe(({ change }) => changes.push(change.kind))
  buffer.checkoutHistoryState(b, view)
  room.flush()
  stop()
  expect(room.texts()).toEqual(['RAB', 'RAB'])
  expect(room.connections[0]!.document.checkpoint().depth).toBe(depth + 1)
  expect(changes.filter((kind) => kind === 'checkout')).toHaveLength(1)
  const viewer = createHistoryViewer(buffer)
  expect(viewer.node(b)?.isCurrent).toBe(true)
  expect(viewer.node(c)).not.toBeNull()
  await commands.editorLook('collaborative-undo-branches')
  viewer.dispose()
  buffer.checkoutHistoryState(c, view)
  room.flush()
  expect(room.texts()).toEqual(['RAC', 'RAC'])
})

test('remote edits preserve preferred redo and never add graph nodes', () => {
  room = new EditorRoom(2, 'A')
  insert('B')
  room.editors[0]!.dispatchCommand('undo')
  const graph = owner().buffer.getHistoryGraph()
  room.editors[1]!.edit({ from: 0, to: 0, text: 'R' })
  room.flush()
  expect(
    owner()
      .buffer.getHistoryGraph()
      .nodes.map((node) => node.id),
  ).toEqual(graph.nodes.map((node) => node.id))
  expect(owner().buffer.canRedo()).toBe(true)
  room.editors[0]!.dispatchCommand('redo')
  room.flush()
  expect(room.texts()).toEqual(['RAB', 'RAB'])
})

test('grouped replacement restores ID-gap multi-cursors only in the initiating view', () => {
  room = new EditorRoom(2, 'abcd')
  const { buffer, view } = owner()
  view.setSelections([
    { anchor: 0, head: 1 },
    { anchor: 3, head: 4 },
  ])
  const other = createEditorViewSession(buffer, 'other-view')
  other.setSelection(2)
  room.editors[0]!.edit([
    { from: 0, to: 1, text: 'X' },
    { from: 3, to: 4, text: 'Y' },
  ])
  room.flush()
  room.editors[1]!.edit({ from: 0, to: 0, text: 'R' })
  room.flush()
  const othersBefore = offsets(other)
  buffer.undo(view)
  room.flush()
  expect(room.texts()).toEqual(['Rabcd', 'Rabcd'])
  expect(offsets(view)).toEqual([
    [1, 2],
    [4, 5],
  ])
  expect(offsets(other)).toEqual(othersBefore)
  buffer.redo(view)
  room.flush()
  expect(room.texts()).toEqual(['RXbcY', 'RXbcY'])
})

test('persistence restores branches by identity and refuses equal text with different IDs', () => {
  room = new EditorRoom(2, '')
  const b = insert('B')
  room.editors[0]!.dispatchCommand('undo')
  const c = insert('C')
  const { buffer, view } = owner()
  const data = structuredClone(buffer.serializeHistory())!
  expect(data).not.toBeNull()
  buffer.clearHistory(view)
  expect(buffer.restoreHistory(data)).toBe(true)
  expect(buffer.getHistoryGraph().currentId).toBe(c)
  buffer.checkoutHistoryState(b, view)
  room.flush()
  expect(room.texts()).toEqual(['B', 'B'])
  buffer.checkoutHistoryState(c, view)
  room.flush()
  buffer.clearHistory(view)
  room.editors[0]!.edit({ from: 0, to: 1, text: 'C' }, { history: 'skip' })
  room.flush()
  expect(room.texts()).toEqual(['C', 'C'])
  expect(buffer.restoreHistory(data)).toBe(false)
})

test('pruning advances the baseline without deactivating its accepted effects', () => {
  room = new EditorRoom(2, '')
  for (let index = 0; index < 205; index++) insert('x')
  const { buffer, view } = owner()
  expect(buffer.getHistoryGraph().nodes).toHaveLength(201)
  const root = buffer.getHistoryGraph().rootId
  expect(root).toBeGreaterThan(0)
  buffer.checkoutHistoryState(root, view)
  room.flush()
  expect(room.texts()).toEqual(['xxxxx', 'xxxxx'])
  expect(buffer.canUndo()).toBe(false)
})

test('close and reopen restores ID-gap branches and continues allocating fresh edits', () => {
  room = new EditorRoom(2, 'seed')
  const b = insert('B')
  room.editors[0]!.dispatchCommand('undo')
  insert('C')
  const data = structuredClone(owner().buffer.serializeHistory())!
  const oldDocument = room.connections[0]!.document
  const records = oldDocument.exportHistory(oldDocument.genesis)!
  room.dispose()
  room = new EditorRoom(2, 'seed')
  for (const { document } of room.connections) document.install(records)
  const { buffer, view } = owner()
  expect(buffer.restoreHistory(data)).toBe(true)
  expect(buffer.getHistoryGraph().nodes.find((node) => node.id === b)?.snapshot.length).toBe(5)
  buffer.checkoutHistoryState(b, view)
  room.flush()
  expect(room.texts()).toEqual(['seedB', 'seedB'])
  insert('D')
  expect(room.texts()).toEqual(['seedBD', 'seedBD'])
  room.editors[0]!.dispatchCommand('undo')
  room.flush()
  expect(room.texts()).toEqual(['seedB', 'seedB'])
})

test('jump history follows remote edits and same-ID revival', () => {
  room = new EditorRoom(2, 'alpha beta gamma')
  const editor = room.editors[0]!
  editor.setSelection(1)
  editor.jumpTo(7)
  editor.jumpTo(13)
  room.editors[1]!.edit({ from: 0, to: 0, text: 'prefix ' })
  room.flush()
  expect(editor.jumpBack()).toBe(true)
  expect(offsets(owner().view)).toEqual([[14, 14]])
  room.editors[1]!.getBufferSession()!.buffer.breakTypingRun()
  room.editors[1]!.edit({ from: 13, to: 18, text: '' })
  room.flush()
  expect(editor.jumpBack()).toBe(true)
  expect(offsets(owner().view)).toEqual([[8, 8]])
  room.editors[1]!.dispatchCommand('undo')
  room.flush()
  expect(editor.jumpForward()).toBe(true)
  expect(offsets(owner().view)).toEqual([[14, 14]])
})

test('persisted author branches survive remote edits after the saved checkpoint', () => {
  room = new EditorRoom(2, 'seed')
  const b = insert('B')
  room.editors[0]!.dispatchCommand('undo')
  insert('C')
  const { buffer, view } = owner()
  const data = structuredClone(buffer.serializeHistory())!
  room.editors[1]!.edit({ from: 5, to: 5, text: 'R' })
  room.flush()
  const remoteId = charIdAt(buffer.getSnapshot(), 5)
  buffer.clearHistory(view)
  expect(buffer.restoreHistory(data)).toBe(true)
  buffer.checkoutHistoryState(b, view)
  room.flush()
  // R remains under C's structural position, ahead of the revived sibling B.
  expect(room.texts()).toEqual(['seedRB', 'seedRB'])
  expect(charIdAt(buffer.getSnapshot(), 4)).toEqual(remoteId)
})

test('persistence refuses missing gap identities and duplicated authored operations', () => {
  room = new EditorRoom(2, 'seed')
  insert('B')
  insert('C')
  const { buffer, view } = owner()
  const original = structuredClone(buffer.serializeHistory())!
  const missingGap = structuredClone(original)
  const edge = missingGap.nodes.find((node) => node.authored)!.authored!
  const selection = edge.before.selections[0]!
  Object.assign(selection.anchor, { left: { bunch: 'unknown', counter: 0 } })
  buffer.clearHistory(view)
  expect(buffer.restoreHistory(missingGap)).toBe(false)
  const duplicate = structuredClone(original)
  const edges = duplicate.nodes.filter((node) => node.authored)
  Object.assign(edges[1]!, { authored: edges[0]!.authored })
  expect(buffer.restoreHistory(duplicate)).toBe(false)
  expect(buffer.restoreHistory(original)).toBe(true)
})
