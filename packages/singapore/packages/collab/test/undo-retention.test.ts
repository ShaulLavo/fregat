import { expect, test } from 'vitest'
import { CollabFailure, UndoManager } from '../src/index'
import type { Envelope, UndoTransaction } from '../src/index'
import { undoRoom } from './undo-fixtures'
import { submitAsAuthor } from './host-fixtures'

function retained(history: UndoManager) {
  const transactions: Map<string, UndoTransaction> = Reflect.get(history, 'transactions')
  const actions: readonly unknown[] = Reflect.get(history, 'actions')
  return {
    transactions: transactions.size,
    actions: actions.length,
    metadataBytes: [...transactions.values()].reduce(
      (sum, transaction) =>
        sum + (transaction.metadata instanceof Uint8Array ? transaction.metadata.byteLength : 0),
      0,
    ),
  }
}

function capture(history: UndoManager, seq: number): Envelope {
  const envelope: Envelope = {
    document: 'retention',
    epoch: '1',
    id: { actor: 'a', seq },
    lamport: seq,
    deps: [],
    change: {
      kind: 'insert',
      start: { bunch: `a:${seq}`, counter: 0 },
      originLeft: 'start',
      originRight: 'end',
      text: 'x',
    },
  }
  history.record(envelope, { boundary: true, metadata: new Uint8Array(1024) })
  return envelope
}

const captures = process.env.COLLAB_STRESS === '1' ? 50_000 : 1_000

test('clears release confirmed transactions and caller metadata', () => {
  const history = new UndoManager(
    'a',
    () => {
      throw new CollabFailure('unexpected-emit')
    },
    { groupDelay: 0 },
  )
  for (let seq = 1; seq <= captures; seq++) history.remote(capture(history, seq))
  expect(retained(history).transactions).toBe(captures)
  history.clearUndo()
  history.clearRedo()
  expect(history.state()).toEqual({ undo: [], redo: [] })
  expect(retained(history)).toEqual({ transactions: 0, actions: 0, metadataBytes: 0 })
})

test('acknowledged records and traversal commands leave the replay journal', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'x', { metadata: new Uint8Array(1024) })
  room.sync()
  expect(retained(room.users[0]!.history)).toEqual({
    transactions: 1,
    actions: 0,
    metadataBytes: 1024,
  })
  room.undo()
  expect(retained(room.users[0]!.history).actions).toBe(1)
  room.sync()
  expect(retained(room.users[0]!.history).actions).toBe(0)
  room.redo()
  room.sync()
  expect(retained(room.users[0]!.history).actions).toBe(0)
  room.converged()
})

test('externally owned graph transactions work after manager references are released', () => {
  const room = undoRoom()
  const metadata = new Uint8Array(1024)
  room.edit(0, 0, 0, 'abc', { metadata })
  room.sync()
  const history = room.users[0]!.history
  const transaction = history.state().undo[0]!
  history.clearUndo()
  history.clearRedo()
  expect(retained(history)).toEqual({ transactions: 0, actions: 0, metadataBytes: 0 })
  expect(transaction.metadata).toBe(metadata)
  history.setActive(transaction, false)
  room.converged()
  expect(room.text()).toBe('')
  history.setActive(transaction, true)
  room.converged()
  expect(room.text()).toBe('abc')
})

test('new confirmed work releases the abandoned redo transaction', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'x', { metadata: new Uint8Array(1024) })
  room.sync()
  room.undo()
  room.sync()
  room.edit(0, 0, 0, 'y')
  room.sync()
  expect(retained(room.users[0]!.history)).toEqual({
    transactions: 1,
    actions: 0,
    metadataBytes: 0,
  })
  room.undo()
  room.converged()
  expect(room.text()).toBe('')
})

test('a pending undo pins the checkpoint transaction until rejection recovery', () => {
  const room = undoRoom()
  const original = room.edit(0, 0, 0, 'x', { metadata: new Uint8Array(1024) })
  room.sync()
  const command = room.undo()
  const history = room.users[0]!.history
  history.clearRedo()
  expect(history.state()).toEqual({ undo: [], redo: [] })
  expect(retained(history).metadataBytes).toBe(1024)
  submitAsAuthor(room.host, { ...command, epoch: 'old' })
  room.users[0]!.participant.receive(room.log)
  expect(history.state()).toMatchObject({ undo: [{ edits: [original.id] }], redo: [] })
  expect(retained(history).actions).toBe(0)
  history.clearUndo()
  expect(retained(history)).toEqual({ transactions: 0, actions: 0, metadataBytes: 0 })
  expect(room.text()).toBe('x')
})

test('both clears remain barriers when pending edit and undo are rejected', () => {
  const room = undoRoom()
  const original = room.edit(0, 0, 0, 'x', { metadata: new Uint8Array(1024) })
  room.undo()
  const history = room.users[0]!.history
  history.clearUndo()
  history.clearRedo()
  submitAsAuthor(room.host, { ...original, epoch: 'old' })
  room.users[0]!.participant.receive(room.log)
  expect(history.state()).toEqual({ undo: [], redo: [] })
  expect(retained(history)).toEqual({ transactions: 0, actions: 0, metadataBytes: 0 })
  expect(room.text()).toBe('')
})

test('acknowledgements behind a pending action retain its recovery suffix', () => {
  const history = new UndoManager(
    'a',
    () => {
      throw new CollabFailure('unexpected-emit')
    },
    { groupDelay: 0 },
  )
  const first = capture(history, 1)
  const second = capture(history, 2)
  history.remote(second)
  expect(retained(history).actions).toBe(2)
  history.reject([first.id])
  expect(history.state().undo.map((transaction) => transaction.id)).toEqual([second.id])
  expect(retained(history)).toEqual({ transactions: 1, actions: 0, metadataBytes: 1024 })
  history.clearUndo()
  expect(retained(history)).toEqual({ transactions: 0, actions: 0, metadataBytes: 0 })
})

test('confirmed edits can continue an open group after its journal prefix is compacted', () => {
  const room = undoRoom({ groupDelay: 500, now: () => 0 })
  const first = room.edit(0, 0, 0, 'x')
  room.sync()
  const rejected = room.edit(0, 1, 0, 'y')
  submitAsAuthor(room.host, { ...rejected, epoch: 'old' })
  room.users[0]!.participant.receive(room.log)
  const history = room.users[0]!.history
  expect(history.state().undo).toMatchObject([{ edits: [first.id] }])
  expect(retained(history).actions).toBe(0)
  room.undo()
  room.converged()
  expect(room.text()).toBe('')
})
