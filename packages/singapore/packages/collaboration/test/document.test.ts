import { expect, test } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CollaborationDocument } from '../src/document'

const options = { peer: 'a', document: 'document', epoch: 'epoch', text: 'seed' }

test('confirmed history bridges Host and Participant, and verifies content and outcomes', () => {
  const a = new CollaborationDocument(options)
  const b = new CollaborationDocument({ ...options, peer: 'b' })
  const edit = a.participant.local({ offset: 4, deleteCount: 0, text: 'a' })
  const record = a.sequence(edit)
  expect(a.participant.state().pending).toEqual([])
  expect(b.apply(record)).toBe(true)
  expect(b.engine.text()).toBe('seeda')
  expect(b.apply(record)).toBe(false)
  const history = a.exportHistory(a.genesis)!
  expect(b.verify(history, a.checkpoint())).toBe(true)
  expect(b.verify([{ ...record, hash: 'bad' }], a.checkpoint())).toBe(false)
  const forged = {
    ...record,
    edit: { ...record.edit, change: { kind: 'delete', spans: [] } as const },
  }
  expect(b.verify([forged], a.checkpoint())).toBe(false)
  expect(b.exportHistory({ depth: 0, hash: 'other' })).toBeUndefined()
})

test('session dependency rejection advances every sequence and retains author undo', () => {
  const a = new CollaborationDocument(options)
  const b = new CollaborationDocument({ ...options, peer: 'b' })
  const rejected = a.participant.local({ offset: 4, deleteCount: 0, text: 'x' })
  const rejection = a.sequence(rejected, 'Dependency unavailable')
  expect(rejection.outcome.kind).toBe('rejected')
  expect(b.apply(rejection)).toBe(true)
  expect(a.engine.text()).toBe('seed')
  const accepted = a.participant.local({ offset: 4, deleteCount: 0, text: 'y' })
  const record = a.sequence(accepted)
  expect(record.depth).toBe(2)
  expect(b.apply(record)).toBe(true)
  expect(b.engine.text()).toBe('seedy')
  const undo = a.participant.undoManager.undo()!
  expect(b.apply(a.sequence(undo))).toBe(true)
  expect(b.engine.text()).toBe('seed')
})

test('branch installation preserves pending work, IDs, and selective undo through handoff', () => {
  const a = new CollaborationDocument(options)
  const b = new CollaborationDocument({ ...options, peer: 'b' })
  const remote = a.participant.local({ offset: 4, deleteCount: 0, text: 'A' })
  a.sequence(remote)
  const local = b.participant.local({ offset: 4, deleteCount: 0, text: 'B' })
  b.install(a.exportHistory(a.genesis)!)
  expect(b.engine.text()).toContain('B')
  expect(b.participant.state().pending.map((edit) => edit.id)).toEqual([local.id])
  const confirmation = b.sequence(local)
  expect(a.apply(confirmation)).toBe(true)
  expect(a.engine.text()).toBe(b.engine.text())
  const undo = b.participant.undoManager.undo()!
  expect(a.apply(b.sequence(undo))).toBe(true)
  expect(a.engine.text()).toBe('seedA')
  b.install([])
  expect(b.checkpoint()).toEqual(b.genesis)
  expect(b.engine.text()).toBe('seed')
})

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

test('a semantically invalid accepted record leaves confirmed ordering unchanged', () => {
  const a = new CollaborationDocument(options)
  const b = new CollaborationDocument({ ...options, peer: 'b' })
  const local = a.participant.local({ offset: 4, deleteCount: 0, text: 'x' })
  const rejected = a.sequence({ ...local, deps: [{ actor: 'missing', seq: 1 }] })
  expect(rejected.outcome.kind).toBe('rejected')
  const body = {
    depth: rejected.depth,
    predecessor: rejected.predecessor,
    id: rejected.id,
    edit: rejected.edit,
    outcome: { kind: 'accepted' } as const,
  }
  const forged = { ...body, hash: bytesToHex(sha256(new TextEncoder().encode(canonical(body)))) }
  expect(b.apply(forged)).toBe(false)
  expect(b.checkpoint()).toEqual(b.genesis)
  expect(b.engine.text()).toBe('seed')
  expect(b.apply(rejected)).toBe(true)
  const next = a.participant.local({ offset: 4, deleteCount: 0, text: 'y' })
  expect(b.apply(a.sequence(next))).toBe(true)
  expect(b.engine.text()).toBe('seedy')
})

test('branch recovery restores losing confirmed origins before dependent pending typing', () => {
  const losing = new CollaborationDocument({ ...options, peer: 'losing' })
  const origin = losing.participant.local({ offset: 4, deleteCount: 0, text: 'A' })
  losing.sequence(origin)
  const dependent = losing.participant.local({ offset: 5, deleteCount: 0, text: 'B' })
  const winner = new CollaborationDocument({ ...options, peer: 'winner' })
  winner.sequence(winner.participant.local({ offset: 0, deleteCount: 0, text: 'X' }))
  winner.sequence(winner.participant.local({ offset: 0, deleteCount: 0, text: 'Y' }))
  expect(() => losing.install(winner.exportHistory(winner.genesis)!, [origin])).not.toThrow()
  expect(losing.engine.text()).toBe('YXseedAB')
  expect(losing.participant.state().blocked).toEqual([])
  expect(losing.participant.state().pending.map((edit) => edit.id)).toEqual([
    origin.id,
    dependent.id,
  ])
  losing.sequence(origin)
  losing.sequence(dependent)
  expect(losing.participant.state().pending).toEqual([])
})

test('unrecoverable branch origins surface a blocked conflict without partial replay', () => {
  const losing = new CollaborationDocument({ ...options, peer: 'losing' })
  losing.sequence(losing.participant.local({ offset: 4, deleteCount: 0, text: 'A' }))
  const dependent = losing.participant.local({ offset: 5, deleteCount: 0, text: 'B' })
  expect(() => losing.install([])).not.toThrow()
  expect(losing.engine.text()).toBe('seed')
  expect(losing.participant.state().blocked).toEqual([dependent.id])
})

test('history identity accepts remote growth but refuses missing remote identities at equal text', () => {
  const a = new CollaborationDocument({ ...options, text: '' })
  const b = new CollaborationDocument({ ...options, peer: 'b', text: '' })
  const remote = b.participant.local({ offset: 0, deleteCount: 0, text: 'R' })
  a.sequence(remote)
  const saved = a.historyIdentity()
  expect(a.matchesHistoryIdentity(saved)).toBe(true)
  const reopened = new CollaborationDocument({ ...options, text: '' })
  reopened.install(a.exportHistory(a.genesis)!)
  expect(reopened.matchesHistoryIdentity(saved)).toBe(true)
  a.sequence(a.participant.local({ offset: 1, deleteCount: 0, text: 'A' }))
  expect(a.matchesHistoryIdentity(saved)).toBe(false)
  const fresh = new CollaborationDocument({ ...options, text: '' })
  const replacement = new CollaborationDocument({ ...options, peer: 'other', text: '' })
  fresh.sequence(replacement.participant.local({ offset: 0, deleteCount: 0, text: 'R' }))
  expect(fresh.engine.text()).toBe(reopened.engine.text())
  expect(fresh.matchesHistoryIdentity(saved)).toBe(false)
  expect(fresh.matchesHistoryIdentity('invalid')).toBe(false)
})

test.each([
  { outcome: 'accepted', restore: 'install' },
  { outcome: 'accepted', restore: 'apply' },
  { outcome: 'rejected', restore: 'install' },
  { outcome: 'rejected', restore: 'apply' },
] as const)(
  'reopening $outcome insertion history with $restore reserves every authored character allocation',
  ({ outcome, restore }) => {
    const original = new CollaborationDocument({ ...options, text: '' })
    const first = original.participant.local({ offset: 0, deleteCount: 0, text: 'A' })
    original.sequence(first, outcome === 'rejected' ? 'test rejection' : undefined)
    const reopened = new CollaborationDocument({ ...options, text: '' })
    const records = original.exportHistory(original.genesis)!
    if (restore === 'install') reopened.install(records)
    if (restore === 'apply') {
      for (const record of records) expect(reopened.apply(record)).toBe(true)
    }
    const second = reopened.participant.local({
      offset: reopened.engine.snapshot().buffer.length,
      deleteCount: 0,
      text: 'B',
    })
    expect(second.id.seq).toBeGreaterThan(first.id.seq)
    if (first.change.kind !== 'insert' || second.change.kind !== 'insert')
      throw new TypeError('Expected insertion envelopes')
    expect(second.change.start).not.toEqual(first.change.start)
  },
)

test('malformed rejected character spans leave allocation recovery usable', () => {
  const original = new CollaborationDocument({ ...options, text: '' })
  expect(() =>
    original.sequence(
      {
        document: options.document,
        epoch: options.epoch,
        id: { actor: options.peer, seq: 1 },
        lamport: 1,
        deps: [],
        change: {
          kind: 'insert',
          start: { bunch: 'a:0', counter: -1 },
          originLeft: 'start',
          originRight: 'end',
          text: 'A',
        },
      },
      'invalid character identity',
    ),
  ).not.toThrow()
  const reopened = new CollaborationDocument({ ...options, text: '' })
  expect(() => reopened.install(original.exportHistory(original.genesis)!)).not.toThrow()
  const next = reopened.participant.local({ offset: 0, deleteCount: 0, text: 'B' })
  expect(next.id.seq).toBe(2)
  reopened.sequence(next)
  expect(reopened.engine.text()).toBe('B')
})
