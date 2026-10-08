// Singapore scenarios from docs/collab-editing/c-undo.md §5, grounded in E017/E018/E020.
import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import {
  createHistoryViewer,
  createEditorViewSession,
  resolveSelection,
} from '@singapore-editor/core/document'
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
