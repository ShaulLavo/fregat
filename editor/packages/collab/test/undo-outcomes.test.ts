import { expect, test } from 'vitest'
import { CollabFailure, UndoManager } from '../src/index'
import { command, insertion } from './undo-work-fixtures'

function settled(history: UndoManager) {
  expect(Reflect.get(history, 'pending').size).toBe(0)
  expect(Reflect.get(history, 'actions')).toHaveLength(0)
}

test.each(['undo', 'redo'] as const)(
  'synchronous acceptance settles %s before observers and publication',
  (kind) => {
    let seq = 1
    let observed = 0
    let published = 0
    const history = new UndoManager(
      'a',
      (effects) => {
        const envelope = command(++seq, effects)
        history.remote(envelope)
        return envelope
      },
      {
        onEvent: (event) => {
          if (event.kind === 'record') return
          settled(history)
          observed++
        },
      },
      () => {
        settled(history)
        published++
      },
    )
    const edit = insertion(1)
    history.record(edit, { metadata: new Uint8Array(1024) })
    history.remote(edit)
    if (kind === 'redo') history.undo()
    expect(history[kind]()).not.toBeNull()
    expect(observed).toBe(kind === 'undo' ? 1 : 2)
    expect(published).toBe(observed)
    settled(history)
    history.clearUndo()
    history.clearRedo()
    expect(Reflect.get(history, 'transactions').size).toBe(0)
    settled(history)
  },
)

test.each(['undo', 'redo'] as const)(
  'synchronous rejection restores %s traversal before observers and publication',
  (kind) => {
    let seq = 1
    let reject = false
    let observed = 0
    const edit = insertion(1)
    const check = () => {
      if (!reject) return
      const state = history.state()
      expect(state[kind]).toMatchObject([{ edits: [edit.id] }])
      expect(state[kind === 'undo' ? 'redo' : 'undo']).toEqual([])
      settled(history)
      observed++
    }
    const history = new UndoManager(
      'a',
      (effects) => {
        const envelope = command(++seq, effects)
        if (reject) history.reject([envelope.id])
        if (!reject) history.remote(envelope)
        return envelope
      },
      {
        onEvent: (event) => {
          if (event.kind !== 'record') check()
        },
      },
      check,
    )
    history.record(edit, { metadata: new Uint8Array(1024) })
    history.remote(edit)
    if (kind === 'redo') history.undo()
    reject = true
    expect(history[kind]()).not.toBeNull()
    expect(observed).toBe(2)
    history.reject([{ actor: 'unrelated', seq: 99 }])
    check()
    history.clearUndo()
    history.clearRedo()
    expect(Reflect.get(history, 'transactions').size).toBe(0)
    settled(history)
  },
)

test.each(['accepted', 'rejected'] as const)(
  'failed emission preserves a synchronous %s outcome for earlier work',
  (outcome) => {
    const edit = insertion(1)
    const history = new UndoManager('a', () => {
      if (outcome === 'accepted') history.remote(edit)
      if (outcome === 'rejected') history.reject([edit.id])
      throw new CollabFailure('unexpected-emit')
    })
    history.record(edit)
    expect(() => history.undo()).toThrow(CollabFailure)
    expect(history.state().undo).toHaveLength(outcome === 'accepted' ? 1 : 0)
    expect(history.state().redo).toEqual([])
    settled(history)
  },
)
