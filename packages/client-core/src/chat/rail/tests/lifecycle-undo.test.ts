import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  commandIdSchema,
  environmentIdSchema,
  sessionIdSchema,
  type SessionLifecycleState,
} from '@workspace/contracts'
import {
  createSessionLifecycleHistory,
  sessionLifecycleUndoEntry,
  sessionLifecycleRestoreCommand,
  type SessionLifecycleUndoEntry,
} from '../lifecycle-undo'

const before: SessionLifecycleState = {
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  activeOrderKey: null,
  acknowledgedFailureThroughSequence: null,
}
function entry(id: string, revision: number, restoreRevision = 0): SessionLifecycleUndoEntry {
  return {
    ref: {
      environmentId: v.parse(environmentIdSchema, '11111111-1111-4111-8111-111111111111'),
      sessionId: v.parse(
        sessionIdSchema,
        `00000000-0000-4000-8000-${Array.from(id)
          .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
          .toString(16)
          .padStart(12, '0')}`,
      ),
    },
    before,
    restoreCommandId: v.parse(commandIdSchema, `command-${revision}`),
    expectedRevision: revision,
    restoreRevision,
  }
}
function inverse(item: SessionLifecycleUndoEntry, revision: number): SessionLifecycleUndoEntry {
  return { ...item, expectedRevision: revision, restoreRevision: item.expectedRevision }
}

test('several actions on one row undo and redo using the revisions produced by each restore', async () => {
  const history = createSessionLifecycleHistory()
  history.record('snooze', [entry('session', 1)])
  history.record('snooze', [entry('session', 2, 1)])
  let revision = 2
  const restore = async (item: SessionLifecycleUndoEntry) => {
    expect(item.expectedRevision).toBe(revision)
    return inverse(item, ++revision)
  }
  await history.step('undo', restore)
  await history.step('undo', restore)
  expect(history.getSnapshot().undo).toHaveLength(0)
  expect(history.getSnapshot().redo).toHaveLength(2)
  await history.step('redo', restore)
  await history.step('redo', restore)
  expect(revision).toBe(6)
  expect(history.getSnapshot().undo).toHaveLength(2)
  expect(history.getSnapshot().redo).toHaveLength(0)
})

test('new actions discard redo and history is bounded', async () => {
  const history = createSessionLifecycleHistory()
  for (let i = 1; i <= 60; i++) history.record('archive', [entry(`session-${i}`, i)])
  expect(history.getSnapshot().undo).toHaveLength(50)
  await history.step('undo', async (item) => inverse(item, 61))
  history.record('settle', [entry('new', 62)])
  expect(history.getSnapshot().redo).toHaveLength(0)
})

test('partial bulk failure preserves successful rows and invalidates only the conflicting row', async () => {
  const history = createSessionLifecycleHistory()
  history.record('snooze', [entry('a', 1)])
  history.record('settle', [entry('a', 2, 1), entry('b', 3)])
  const result = await history.step('undo', async (item) =>
    item.ref.sessionId === entry('a', 1).ref.sessionId ? null : inverse(item, 4),
  )
  expect(result.failed).toBe(1)
  expect(history.getSnapshot().undo).toHaveLength(0)
  expect(history.getSnapshot().redo[0]?.entries.map((item) => item.ref.sessionId)).toEqual([
    entry('b', 3).ref.sessionId,
  ])
})

test('a restore uses the action receipt even when a projection has moved ahead', () => {
  const item = entry('session', 42)
  const captured = sessionLifecycleUndoEntry(item.ref, {
    deduped: false,
    sequence: 42,
    result: null,
    lifecycle: {
      kind: 'session.lifecycle',
      commandId: item.restoreCommandId,
      sessionId: item.ref.sessionId,
      beforeRevision: 19,
      before,
    },
  })
  expect(captured).toMatchObject({ expectedRevision: 42, restoreRevision: 19, before })
  expect(sessionLifecycleRestoreCommand(captured!)).toMatchObject({
    type: 'session.lifecycle.restore',
    expectedRevision: 42,
    restoreCommandId: item.restoreCommandId,
  })
})

test('recording a new action while a restore settles keeps the new redo branch empty', async () => {
  const history = createSessionLifecycleHistory()
  history.record('archive', [entry('a', 1)])
  let release: (value: SessionLifecycleUndoEntry | null) => void = () => {}
  const waiting = new Promise<SessionLifecycleUndoEntry | null>((resolve) => {
    release = resolve
  })
  const undo = history.step('undo', () => waiting)
  history.record('snooze', [entry('b', 3)])
  release(inverse(entry('a', 1), 2))
  await undo
  expect(history.getSnapshot().redo).toHaveLength(0)
  expect(history.getSnapshot().undo.at(-1)?.kind).toBe('snooze')
})
