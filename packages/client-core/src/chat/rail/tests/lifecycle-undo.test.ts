import { describe, expect, test } from 'vitest'
import type { EnvironmentId, SessionId } from '@workspace/contracts'
import {
  captureSessionLifecycle,
  forgetSessionLifecycleUndo,
  offerSessionLifecycleUndo,
  sessionLifecycleRestoreCommand,
  sessionLifecycleRestoreSteps,
  sessionLifecycleVerb,
} from '../lifecycle-undo'

const NOW = Date.parse('2026-09-25T12:00:00.000Z')
const LATER = '2026-09-25T13:00:00.000Z'
const EARLIER = '2026-09-25T11:00:00.000Z'

function ref(sessionId: string, environmentId = 'env') {
  return { environmentId: environmentId as EnvironmentId, sessionId: sessionId as SessionId }
}

function entry(sessionId: string, environmentId = 'env') {
  return { ref: ref(sessionId, environmentId), before: captureSessionLifecycle({}) }
}

describe('captured lifecycle', () => {
  test('reads a pin key only while pinned and normalises absent fields', () => {
    expect(captureSessionLifecycle({})).toEqual({
      archived: false,
      settled: false,
      snoozedUntil: null,
      pinned: false,
      pinOrderKey: null,
      activeOrderKey: null,
    })
    expect(
      captureSessionLifecycle({ pinnedAt: null, pinOrderKey: 'm', settledOverride: 'active' }),
    ).toMatchObject({ pinned: false, pinOrderKey: null, settled: false })
    expect(
      captureSessionLifecycle({
        archivedAt: EARLIER,
        pinnedAt: EARLIER,
        pinOrderKey: 'm',
        settledOverride: 'settled',
        activeOrderKey: 'c',
        snoozedUntil: LATER,
      }),
    ).toEqual({
      archived: true,
      settled: true,
      snoozedUntil: LATER,
      pinned: true,
      pinOrderKey: 'm',
      activeOrderKey: 'c',
    })
  })
})

describe('restore steps', () => {
  test('settle Undo un-settles, then restores the active slot, the pin key and the snooze', () => {
    const before = captureSessionLifecycle({
      pinnedAt: EARLIER,
      pinOrderKey: 'm',
      activeOrderKey: 'c',
      snoozedUntil: LATER,
    })
    expect(sessionLifecycleRestoreSteps('settle', before, NOW)).toEqual([
      { type: 'unsettle' },
      { type: 'active.reorder', orderKey: 'c' },
      { type: 'pin', orderKey: 'm' },
      { type: 'snooze', snoozedUntil: LATER },
    ])
  })

  test('settle Undo of a plain active row only un-settles, and of a settled row only re-snoozes', () => {
    expect(sessionLifecycleRestoreSteps('settle', captureSessionLifecycle({}), NOW)).toEqual([
      { type: 'unsettle' },
    ])
    expect(
      sessionLifecycleRestoreSteps(
        'settle',
        captureSessionLifecycle({ settledOverride: 'settled', snoozedUntil: LATER }),
        NOW,
      ),
    ).toEqual([{ type: 'snooze', snoozedUntil: LATER }])
  })

  test('a keyless pin returns keyless so it keeps its creation-ordered place', () => {
    const before = captureSessionLifecycle({ pinnedAt: EARLIER, pinOrderKey: null })
    expect(sessionLifecycleRestoreSteps('unpin', before, NOW)).toEqual([{ type: 'pin' }])
  })

  test('unpin Undo re-snoozes after the pin, which spends a snooze', () => {
    const before = captureSessionLifecycle({
      pinnedAt: EARLIER,
      pinOrderKey: 'm',
      snoozedUntil: LATER,
    })
    expect(sessionLifecycleRestoreSteps('unpin', before, NOW)).toEqual([
      { type: 'pin', orderKey: 'm' },
      { type: 'snooze', snoozedUntil: LATER },
    ])
    expect(sessionLifecycleRestoreSteps('unpin', captureSessionLifecycle({}), NOW)).toEqual([])
  })

  test('snooze Undo returns to the earlier wake time while it is still ahead', () => {
    expect(sessionLifecycleRestoreSteps('snooze', captureSessionLifecycle({}), NOW)).toEqual([
      { type: 'unsnooze' },
    ])
    expect(
      sessionLifecycleRestoreSteps('snooze', captureSessionLifecycle({ snoozedUntil: LATER }), NOW),
    ).toEqual([{ type: 'snooze', snoozedUntil: LATER }])
    expect(
      sessionLifecycleRestoreSteps(
        'snooze',
        captureSessionLifecycle({ snoozedUntil: EARLIER }),
        NOW,
      ),
    ).toEqual([{ type: 'unsnooze' }])
  })

  test('archive Undo unarchives only a row that was visible', () => {
    expect(sessionLifecycleRestoreSteps('archive', captureSessionLifecycle({}), NOW)).toEqual([
      { type: 'unarchive' },
    ])
    expect(
      sessionLifecycleRestoreSteps(
        'archive',
        captureSessionLifecycle({ archivedAt: EARLIER }),
        NOW,
      ),
    ).toEqual([])
  })

  test('each step becomes its orchestration command', () => {
    const sessionId = 'session' as SessionId
    expect(sessionLifecycleRestoreCommand(sessionId, { type: 'unarchive' })).toMatchObject({
      type: 'session.unarchive',
      sessionId,
    })
    expect(
      sessionLifecycleRestoreCommand(sessionId, { type: 'active.reorder', orderKey: 'c' }),
    ).toMatchObject({ type: 'session.active.reorder', sessionId, orderKey: 'c' })
    expect(sessionLifecycleRestoreCommand(sessionId, { type: 'pin', orderKey: 'm' })).toMatchObject(
      { type: 'session.pin', sessionId, orderKey: 'm' },
    )
    expect(sessionLifecycleRestoreCommand(sessionId, { type: 'pin' })).not.toHaveProperty(
      'orderKey',
    )
    expect(sessionLifecycleRestoreCommand(sessionId, { type: 'unsettle' })).toMatchObject({
      type: 'session.unsettle',
      reason: 'user',
    })
  })
})

describe('latest-undo slot', () => {
  test('same-kind actions join the slot and a repeated session keeps only its newer entry', () => {
    const first = offerSessionLifecycleUndo(null, 'settle', [entry('a'), entry('b')])
    const newer = { ...entry('a'), before: captureSessionLifecycle({ pinnedAt: EARLIER }) }
    const joined = offerSessionLifecycleUndo(first, 'settle', [newer])
    expect(joined?.kind).toBe('settle')
    expect(joined?.entries.map((item) => item.ref.sessionId)).toEqual(['b', 'a'])
    expect(joined?.entries[1]?.before.pinned).toBe(true)
  })

  test('another kind takes the slot over and an empty offer changes nothing', () => {
    const settled = offerSessionLifecycleUndo(null, 'settle', [entry('a')])
    expect(offerSessionLifecycleUndo(settled, 'archive', [])).toBe(settled)
    expect(offerSessionLifecycleUndo(settled, 'archive', [entry('b')])).toEqual({
      kind: 'archive',
      entries: [entry('b')],
    })
  })

  test('forgetting drops only the scoped session and empties to no slot', () => {
    const slot = offerSessionLifecycleUndo(null, 'unpin', [entry('a'), entry('a', 'other')])
    expect(forgetSessionLifecycleUndo(slot, [ref('b')])).toBe(slot)
    expect(forgetSessionLifecycleUndo(slot, [ref('a')])?.entries).toEqual([entry('a', 'other')])
    expect(forgetSessionLifecycleUndo(slot, [ref('a'), ref('a', 'other')])).toBeNull()
    expect(forgetSessionLifecycleUndo(null, [ref('a')])).toBeNull()
  })
})

test('one verb table names both the Undo notice and the plain lifecycle toast', () => {
  expect(
    (['archive', 'settle', 'unsettle', 'snooze', 'unsnooze', 'pin', 'unpin'] as const).map(
      sessionLifecycleVerb,
    ),
  ).toEqual([
    'archived',
    'settled',
    'moved to active',
    'snoozed',
    'unsnoozed',
    'pinned',
    'unpinned',
  ])
})
