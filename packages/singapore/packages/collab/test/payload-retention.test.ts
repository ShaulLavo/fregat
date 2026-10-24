import { expect, test } from 'vitest'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import {
  reclaimPieceTableText,
  reclaimSnapshotStorage,
} from '@singapore-editor/textbuffer/internal/reclamation'
import { createSnapshot } from '@singapore-editor/textbuffer/internal/snapshot'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import { Host, Participant, TextbufferEngine } from '../src/index'
import type { Envelope } from '../src/index'

function collect(snapshots: readonly PieceTableSnapshot[]) {
  const job = reclaimSnapshotStorage(snapshots)
  let step = job.next()
  while (!step.done) step = job.next()
  return step.value
}
function setup(transient: boolean) {
  const engine = new TextbufferEngine(
    createPieceTableSnapshot('abcdef', {
      normalized: true,
      transient,
      charIds: { bunch: 'original', counter: 0 },
    }),
  )
  const participant = new Participant({
    actor: 'a',
    document: 'd',
    epoch: '1',
    engine,
    undo: { groupDelay: 0 },
  })
  const deletion = participant.local({ offset: 1, deleteCount: 3, text: '' })
  const undoId = { actor: 'a', seq: 2 }
  const undo: Envelope = {
    ...deletion,
    id: undoId,
    change: {
      kind: 'setEffects',
      command: undoId,
      effects: [{ op: deletion.id, active: false }],
    },
  }
  return { engine, participant, deletion, undo }
}

// Collecting an unowned copy deliberately excludes the active provenance's retention roots.
function expireCopy(buffer: PieceTableSnapshot) {
  const copy = createSnapshot(buffer.buffers, buffer.root, buffer.reverseIndex, buffer.charIds)
  expect(collect([copy]).codeUnits).toBe(3)
  return copy
}

test.each([false, true])(
  'provenance keeps undo payloads through reclamation with transient=%s',
  (transient) => {
    const { engine, participant } = setup(transient)
    const saved = engine.snapshot()
    expect(collect([saved.buffer]).codeUnits).toBe(0)
    expect(reclaimPieceTableText(saved.buffer)).toBe(saved.buffer)
    participant.undoManager.undo()
    expect(engine.text()).toBe('abcdef')
    participant.undoManager.redo()
    expect(engine.text()).toBe('aef')
    expect(collect([engine.snapshot().buffer]).codeUnits).toBe(0)
    engine.restore(saved)
    participant.undoManager.undo()
    expect(engine.text()).toBe('abcdef')
  },
)

test.each([false, true])(
  'expired effect batches preserve snapshots and dedup state with transient=%s',
  (transient) => {
    const { engine, undo, deletion } = setup(transient)
    const inserted = engine.author(
      { offset: 0, deleteCount: 0, text: 'X' },
      {
        document: 'd',
        epoch: '1',
        id: { actor: 'a', seq: 3 },
        lamport: 3,
        deps: [],
        allocate: () => ({ bunch: 'extra', counter: 0 }),
      },
    )
    engine.apply(inserted)
    const saved = engine.snapshot()
    const expired = { ...saved, buffer: expireCopy(saved.buffer) }
    engine.restore(expired)
    const batch: Envelope = {
      ...undo,
      change: {
        ...(undo.change as Extract<Envelope['change'], { kind: 'setEffects' }>),
        effects: [
          { op: inserted.id, active: false },
          { op: deletion.id, active: false },
        ],
      },
    }
    expect(() => engine.apply(batch)).toThrow('expired-character-payload')
    expect(engine.snapshot()).toBe(expired)
    expect(engine.text()).toBe('Xaef')
    expect(() => engine.apply(batch)).toThrow('expired-character-payload')
    expect(engine.snapshot()).toBe(expired)
  },
)

test.each([false, true])(
  'host rejects genuinely expired revival with a clear outcome with transient=%s',
  (transient) => {
    const engine = new TextbufferEngine(
      createPieceTableSnapshot('abcdef', {
        normalized: true,
        transient,
        charIds: { bunch: 'original', counter: 0 },
      }),
    )
    const { deletion, undo } = setup(transient)
    const host = new Host({ document: 'd', epoch: '1', engine })
    expect(host.submit(deletion, 'a').status).toBe('accepted')
    const saved = engine.snapshot()
    const expired = { ...saved, buffer: expireCopy(saved.buffer) }
    engine.restore(expired)
    const result = host.submit(undo, 'a')
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'expired-character-payload',
      sequence: 2,
    })
    expect(engine.snapshot()).toBe(expired)
    expect(host.text()).toBe('aef')
    expect(host.submit(undo, 'a')).toEqual(result)
  },
)

test.each([false, true])(
  'retained prior snapshots keep immutable provenance roots with transient=%s',
  (transient) => {
    const { engine, participant } = setup(transient)
    const prior = engine.snapshot()
    participant.local({ offset: 0, deleteCount: 0, text: 'XYZ' })
    participant.undoManager.undo()
    expect(engine.text()).toBe('aef')
    const current = engine.snapshot()
    expect(collect([prior.buffer, current.buffer]).codeUnits).toBe(0)
    participant.undoManager.redo()
    expect(engine.text()).toBe('XYZaef')
    engine.restore(prior)
    expect(engine.text()).toBe('aef')
    expect(collect([prior.buffer]).codeUnits).toBe(0)
  },
)
