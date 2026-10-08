import { expect, test } from 'vitest'
import { Host, InMemoryTransport, Participant, ReferenceEngine, simulate } from '../src/index'
import type { Envelope } from '../src/index'
import { Effects } from '../src/effects'
import { undoRoom } from './undo-fixtures'

const stress = process.env.COLLAB_STRESS === '1'
const randomRounds = stress ? 100 : 8
const randomSteps = stress ? 64 : 24

test('review: undo middle deletion through deleted surroundings retains original IDs', () => {
  const room = undoRoom({ groupDelay: 0 }, 3)
  room.edit(2, 0, 0, 'abcde')
  room.sync()
  const ids = room.engine.snapshot().nodes.map((n) => n.id)
  room.edit(0, 1, 3, '')
  room.sync()
  room.edit(1, 0, 2, '')
  room.sync()
  room.undo(0)
  room.converged()
  expect(room.text()).toBe('bcd')
  expect(room.engine.snapshot().nodes.map((n) => n.id)).toEqual(ids)
})

test('review: Bob replacement survives Alice insertion undo and redo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'abc')
  room.sync()
  room.edit(1, 1, 1, 'X')
  room.sync()
  room.undo(0)
  room.converged()
  expect(room.text()).toBe('X')
  room.redo(0)
  room.converged()
  expect(room.text()).toBe('aXc')
  room.undo(1)
  room.converged()
  expect(room.text()).toBe('abc')
})

test('review: transport must reject impersonated effect commands', () => {
  const engine = new ReferenceEngine()
  const host = new Host({ document: 'd', epoch: '1', engine })
  const alice = new Participant({
    actor: 'alice',
    document: 'd',
    epoch: '1',
    engine: new ReferenceEngine(),
  })
  const bob = new Participant({
    actor: 'bob',
    document: 'd',
    epoch: '1',
    engine: new ReferenceEngine(),
  })
  const transport = new InMemoryTransport(host, [alice, bob])
  const edit = alice.local({ offset: 0, deleteCount: 0, text: 'Alice' })
  transport.submit(alice, edit)
  transport.quiesce()
  const id = { actor: 'alice', seq: 2 }
  const forged: Envelope = {
    ...edit,
    id,
    lamport: 2,
    deps: [edit.id],
    change: {
      kind: 'setEffects',
      command: id,
      effects: [{ op: edit.id, active: false }],
    },
  }
  expect(() => transport.submit(bob, forged)).toThrow('sender-mismatch')
  expect(() => host.submit(forged, bob.actor)).toThrow('sender-mismatch')
  transport.quiesce()
  expect(host.outcome(id)?.status).not.toBe('accepted')
  expect(host.text()).toBe('Alice')
  transport.close()
})

test('review: remote undo touching local group seals its capture boundary', () => {
  const room = undoRoom({ groupDelay: 500, now: () => 0 })
  room.edit(1, 0, 0, 'abc')
  room.sync()
  room.edit(0, 1, 1, '')
  room.sync()
  room.undo(1)
  room.sync()
  room.edit(0, 0, 0, 'Y')
  const groupCount = room.users[0]!.history.state().undo.length
  room.undo(0)
  room.converged()
  room.redo(1)
  room.converged()
  expect(room.text()).toBe('ac')
  expect(groupCount).toBe(2)
})

test('review: concurrent simulator detects last-delete-wins visibility mutant', () => {
  const original = Effects.prototype.visible
  let changedProjections = 0
  Effects.prototype.visible = function (id) {
    const snap = this.snapshot()
    const spans = snap.runs.find(([bunch]) => bunch === id.bunch)?.[1] ?? []
    const span = spans.find((s) => s.start <= id.counter && id.counter < s.start + s.count)
    const states = new Map(snap.states)
    const visible =
      !!span &&
      states.get(span.insert) === true &&
      (span.deletes.length === 0 || states.get(span.deletes.at(-1)!) === false)
    if (visible !== original.call(this, id)) changedProjections++
    return visible
  }
  let failure: unknown
  let seeds = 0
  // Seed 6 reaches overlapping deletion effects at step 27.
  const seedsToCheck = stress ? Array.from({ length: 500 }, (_, seed) => seed) : [6]
  try {
    for (const seed of seedsToCheck) {
      seeds++
      simulate({ seed, participants: 3 + (seed % 3), undoRedo: true })
    }
  } catch (error) {
    failure = error
  } finally {
    Effects.prototype.visible = original
  }
  console.log('SCALAR ORACLE MUTATION:', {
    seeds,
    changedProjections,
    detected: !!failure,
  })
  expect(changedProjections).toBeGreaterThan(0)
  expect(failure, 'independent concurrent visibility oracle must kill mutant').toMatchObject({
    code: expect.stringMatching(/^oracle-visibility-/),
  })
})

function independentlyCheck(seed: number) {
  const engine = new ReferenceEngine()
  const host = new Host({ document: 'oracle', epoch: '1', engine })
  const participants = ['a', 'b', 'c'].map(
    (actor) =>
      new Participant({
        actor,
        document: 'oracle',
        epoch: '1',
        engine: new ReferenceEngine(),
        undo: { groupDelay: 0 },
      }),
  )
  const chars = new Map<string, { text: string; insert: string; deletes: Set<string> }>()
  const states = new Map<string, boolean>()
  const key = (id: { actor: string; seq: number }) => JSON.stringify([id.actor, id.seq])
  const char = (id: { bunch: string; counter: number }) => JSON.stringify([id.bunch, id.counter])
  let expected = ''
  host.subscribe((message) => {
    if (message.status !== 'accepted') throw new TypeError('unexpected rejection')
    const env = message.envelope
    const change = env.change
    if (change.kind === 'setEffects') {
      for (const e of change.effects) states.set(key(e.op), e.active)
    } else {
      const op = key(env.id)
      states.set(op, true)
      let insert = null
      if (change.kind === 'insert') insert = change
      if (change.kind === 'replace') insert = change.insert
      if (insert)
        for (let i = 0; i < insert.text.length; i++)
          chars.set(char({ bunch: insert.start.bunch, counter: insert.start.counter + i }), {
            text: insert.text[i]!,
            insert: op,
            deletes: new Set(),
          })
      if (change.kind !== 'insert')
        for (const span of change.spans)
          for (let i = 0; i < span.count; i++)
            chars
              .get(char({ bunch: span.start.bunch, counter: span.start.counter + i }))!
              .deletes.add(op)
    }
    // Host drains ready dependants before publishing; inspect the completed batch.
    if (message.sequence !== host.hostSequence) return
    const visible = engine.snapshot().nodes.flatMap((node) => {
      const item = chars.get(char(node.id))!
      let live = !!states.get(item.insert)
      for (const deletion of item.deletes) if (states.get(deletion)) live = false
      expect(
        node.deleted,
        `independent visibility seed ${seed}, host sequence ${host.hostSequence}, ID ${char(node.id)}`,
      ).toBe(!live)
      return live ? [{ offset: engine.visibleOffset(node.id)!, text: item.text }] : []
    })
    // Placement already has a separate oracle; verify visibility independently per ID.
    expected = visible
      .sort((a, b) => a.offset - b.offset)
      .map((item) => item.text)
      .join('')
    expect(
      engine.text(),
      `independent oracle seed ${seed}, host sequence ${host.hostSequence}`,
    ).toBe(expected)
  })
  let state = seed
  const random = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor((state / 0x100000000) * n)
  }
  const transport = new InMemoryTransport(host, participants, () => random(5))
  const submit = (envelope: Envelope) => {
    transport.submit(
      participants.find((p) => p.actor === envelope.id.actor)!,
      envelope,
    )
    transport.quiesce()
  }
  try {
    submit(participants[0]!.local({ offset: 0, deleteCount: 0, text: 'abc' }, { boundary: true }))
    const a = participants[0]!.local({ offset: 1, deleteCount: 1, text: '' }, { boundary: true })
    const b = participants[1]!.local({ offset: 1, deleteCount: 1, text: '' }, { boundary: true })
    submit(a)
    submit(b)
    submit(participants[0]!.undoManager.undo()!)
    submit(participants[1]!.undoManager.undo()!)
    submit(participants[0]!.undoManager.redo()!)
    for (let step = 0; step < randomSteps; step++) {
      const p = participants[random(3)]!
      const action = random(5)
      let env = action === 0 ? p.undoManager.undo() : null
      if (action === 1) env = p.undoManager.redo()
      if (!env) {
        const text = p.text()
        const offset = random(text.length + 1)
        const count = Math.min(random(4), text.length - offset)
        env = p.local(
          { offset, deleteCount: count, text: count && random(2) ? '' : 'xy'[random(2)]! },
          { boundary: true },
        )
      }
      transport.submit(p, env, random(5))
      if (random(4) === 0) transport.submit(p, env, random(5))
      transport.advance(random(3))
    }
    transport.quiesce()
    for (const p of participants) {
      expect(p.text()).toBe(expected)
      expect(p.state().pending).toHaveLength(0)
    }
  } finally {
    transport.close()
  }
}

test('review: independent per-character oracle checks concurrent random edits and undo', () => {
  for (let seed = 0; seed < randomRounds; seed++) independentlyCheck(seed)
})

test('review: independent per-character oracle kills last-delete-wins mutant', () => {
  const original = Effects.prototype.visible
  Effects.prototype.visible = function (id) {
    const snap = this.snapshot()
    const spans = snap.runs.find(([bunch]) => bunch === id.bunch)?.[1] ?? []
    const span = spans.find((s) => s.start <= id.counter && id.counter < s.start + s.count)
    const states = new Map(snap.states)
    return (
      !!span &&
      states.get(span.insert) === true &&
      (span.deletes.length === 0 || states.get(span.deletes.at(-1)!) === false)
    )
  }
  let failure: unknown
  try {
    independentlyCheck(0)
  } catch (error) {
    failure = error
    console.log('INDEPENDENT MUTATION CONTROL:', String(error))
  } finally {
    Effects.prototype.visible = original
  }
  expect(failure).toBeDefined()
})
