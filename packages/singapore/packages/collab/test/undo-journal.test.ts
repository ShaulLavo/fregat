import { expect, test } from 'vitest'
import { UndoManager } from '../src/index'
import type { Envelope } from '../src/index'

type Action =
  | { kind: 'record' | 'undo' | 'redo'; id: number; transaction: number }
  | { kind: 'clearUndo' }
  | { kind: 'clearRedo' }

function replay(actions: readonly Action[], rejected: ReadonlySet<number>) {
  let undo: number[] = []
  let redo: number[] = []
  for (const action of actions) {
    if (action.kind === 'clearUndo') {
      undo = []
      continue
    }
    if (action.kind === 'clearRedo') {
      redo = []
      continue
    }
    if (rejected.has(action.id)) continue
    if (action.kind === 'record') {
      undo.push(action.transaction)
      redo = []
      continue
    }
    const from = action.kind === 'undo' ? undo : redo
    const to = action.kind === 'undo' ? redo : undo
    const index = from.indexOf(action.transaction)
    if (index < 0) continue
    from.splice(index, 1)
    to.push(action.transaction)
  }
  return { undo, redo }
}

test.each(Array.from({ length: 40 }, (_, seed) => seed))(
  'compacted checkpoints match full journal replay across clears and delayed outcomes, seed %i',
  (seed) => {
    let randomState = seed
    const random = (count: number) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      return Math.floor((randomState / 0x100000000) * count)
    }
    let sequence = 0
    const pending = new Map<number, Envelope>()
    const actions: Action[] = []
    const rejected = new Set<number>()
    const history = new UndoManager(
      'a',
      (effects) => {
        const id = { actor: 'a', seq: ++sequence }
        return {
          document: 'journal',
          epoch: '1',
          id,
          lamport: sequence,
          deps: [],
          change: { kind: 'setEffects', command: id, effects },
        }
      },
      { groupDelay: 0 },
    )
    for (let step = 0; step < 128; step++) {
      const action = random(9)
      const before = replay(actions, rejected)
      if (action < 3) {
        const id = { actor: 'a', seq: ++sequence }
        const envelope: Envelope = {
          document: 'journal',
          epoch: '1',
          id,
          lamport: sequence,
          deps: [],
          change: {
            kind: 'insert',
            start: { bunch: `a:${sequence}`, counter: 0 },
            originLeft: 'start',
            originRight: 'end',
            text: 'x',
          },
        }
        history.record(envelope, { boundary: true })
        pending.set(sequence, envelope)
        actions.push({ kind: 'record', id: sequence, transaction: sequence })
      }
      if (action === 3 || action === 4) {
        const kind = action === 3 ? 'undo' : 'redo'
        const envelope = history[kind]()
        const transaction = before[kind].at(-1)
        expect(envelope === null).toBe(transaction === undefined)
        if (envelope) {
          actions.push({ kind, id: sequence, transaction: transaction! })
          pending.set(sequence, envelope)
        }
      }
      if (action === 5 || action === 6) {
        const kind = action === 5 ? 'clearUndo' : 'clearRedo'
        history[kind]()
        actions.push({ kind })
      }
      if (action >= 7 && pending.size > 0) {
        const envelope = [...pending.values()][random(pending.size)]!
        pending.delete(envelope.id.seq)
        if (action === 7) history.remote(envelope)
        if (action === 8) {
          rejected.add(envelope.id.seq)
          history.reject([envelope.id])
        }
      }
      const actual = history.state()
      expect(
        {
          undo: actual.undo.map((transaction) => transaction.id.seq),
          redo: actual.redo.map((transaction) => transaction.id.seq),
        },
        `seed ${seed}, step ${step}`,
      ).toEqual(replay(actions, rejected))
    }
    for (const envelope of pending.values()) history.remote(envelope)
    history.clearUndo()
    history.clearRedo()
    expect(Reflect.get(history, 'transactions').size, `seed ${seed}`).toBe(0)
    expect(Reflect.get(history, 'actions'), `seed ${seed}`).toHaveLength(0)
    expect(Reflect.get(history, 'pending').size, `seed ${seed}`).toBe(0)
    expect(Reflect.get(history, 'journalReferences').size, `seed ${seed}`).toBe(0)
  },
)
