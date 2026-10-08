import { createEngine } from './engine-fixture'
import { submitAsAuthor } from './host-fixtures'
import { expect } from 'vitest'
import { Host, Participant } from '../src/index'
import type { CaptureOptions, Envelope, HostMessage, UndoOptions } from '../src/index'

export function undoRoom(options: UndoOptions = { groupDelay: 0 }, count = 2) {
  const engine = createEngine()
  const host = new Host({ document: 'undo', epoch: '1', engine })
  const log: HostMessage[] = []
  host.subscribe((message) => log.push(message))
  const users = Array.from({ length: count }, (_, index) => {
    const engine = createEngine()
    const participant = new Participant({
      actor: String(index),
      document: 'undo',
      epoch: '1',
      engine,
      undo: options,
    })
    return { engine, participant, history: participant.undoManager }
  })
  function sync(selected: readonly number[] = users.map((_, index) => index)) {
    for (const index of selected)
      for (const envelope of users[index]!.participant.state().pending) {
        const result = submitAsAuthor(host, envelope)
        expect(result.status).not.toBe('rejected')
      }
    for (const index of selected) users[index]!.participant.receive(log)
  }
  function edit(
    user: number,
    offset: number,
    deleteCount: number,
    text: string,
    capture: CaptureOptions = {},
  ) {
    return users[user]!.participant.local({ offset, deleteCount, text }, capture)
  }
  function undo(user = 0): Envelope {
    const envelope = users[user]!.history.undo()
    if (!envelope) throw new TypeError('Expected undo command')
    return envelope
  }
  function redo(user = 0): Envelope {
    const envelope = users[user]!.history.redo()
    if (!envelope) throw new TypeError('Expected redo command')
    return envelope
  }
  function converged() {
    sync()
    for (const user of users) {
      expect(user.participant.text()).toBe(host.text())
      expect(user.engine.characters()).toEqual(engine.characters())
      expect(user.participant.state()).toMatchObject({
        pending: [],
        blocked: [],
        hostSequence: host.hostSequence,
      })
    }
  }
  return {
    host,
    engine,
    users,
    log,
    edit,
    undo,
    redo,
    sync,
    converged,
    text: (user = 0) => users[user]!.participant.text(),
  }
}
