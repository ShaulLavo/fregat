import { expect, test } from 'vitest'
import { UndoManager } from '../src/undo'
import { command, historyWork, insertion } from './undo-work-fixtures'
import type { Workload } from './undo-work-fixtures'

const workloads: Workload[] = ['undo', 'redo', 'acknowledge', 'reject-group', 'non-top-replay']

test.each(workloads)('%s settlement work grows linearly from n to 4n', (kind) => {
  const small = historyWork(256, kind)
  const large = historyWork(1024, kind)
  expect(small.total).toBeGreaterThan(0)
  expect(large.total, JSON.stringify({ small, large })).toBeLessThanOrEqual(small.total * 5)
  expect(large.total).toBeLessThan(1024 * 96)
  const expected = {
    undo: { undo: 0, redo: 1024 },
    redo: { undo: 1024, redo: 0 },
    acknowledge: { undo: 1024, redo: 0 },
    'reject-group': { undo: 0, redo: 0 },
    'non-top-replay': { undo: 1, redo: 1023 },
  }
  expect({ undo: large.undo, redo: large.redo }).toEqual(expected[kind])
})

test('consumed journal slots release action references before the suffix is copied', () => {
  const history = new UndoManager('a', (effects) => command(5, effects))
  const edits = Array.from({ length: 4 }, (_, index) => insertion(index + 1))
  for (const edit of edits) history.record(edit, { boundary: true })
  history.remote(edits[0]!)
  expect(Reflect.get(history, 'actionHead')).toBe(1)
  expect(Reflect.get(history, 'actions')).toHaveLength(4)
  expect(Reflect.get(history, 'actions')[0]).toBeNull()
  history.reject([edits[1]!.id])
  expect(history.state().undo.map((transaction) => transaction.id.seq)).toEqual([1, 3, 4])
  history.remote(edits[2]!)
  history.remote(edits[3]!)
  expect(Reflect.get(history, 'actionHead')).toBe(0)
  expect(Reflect.get(history, 'actions')).toEqual([])
})

test('batched partial rejection preserves accepted and unresolved members of one group', () => {
  const history = new UndoManager('a', (effects) => command(5, effects))
  const edits = Array.from({ length: 4 }, (_, index) => insertion(index + 1))
  const metadata = new Uint8Array(1024)
  history.beginTransaction(metadata)
  for (const edit of edits) history.record(edit)
  history.endTransaction()
  history.remote(edits[0]!)
  history.reject([edits[1]!.id, edits[3]!.id])
  expect(history.state().undo[0]).toMatchObject({ edits: [edits[0]!.id, edits[2]!.id] })
  expect(history.state().undo[0]!.metadata).toBe(metadata)
  history.remote(edits[2]!)
  expect(Reflect.get(history, 'actions')).toEqual([])
  history.clearUndo()
  expect(Reflect.get(history, 'transactions').size).toBe(0)
})
