import { describe, expect, test } from 'vitest'
import {
  compareActiveSessions,
  comparePinnedSessions,
  settledSessionTimestamp,
} from '../session-order'
import { planRailReorder } from '../reorder'
import { planRailDrop, railMarkerId, resolveRailDropTarget, type RailListItem } from '../drop'

describe('shelf sorting', () => {
  test('equal pin keys use identity, while active keyless rows lead with re-entry timestamps', () => {
    const rows = [
      {
        id: 'same',
        environmentId: 'z',
        createdAt: '2026-01-04',
        pinOrderKey: 'b',
        activeOrderKey: 'b',
      },
      {
        id: 'same',
        environmentId: 'a',
        createdAt: '2026-01-01',
        pinOrderKey: 'b',
        activeOrderKey: 'c',
      },
      { id: 'new', environmentId: 'a', createdAt: '2026-01-02', unsettledAt: '2026-01-05' },
      { id: 'bad', environmentId: 'a', createdAt: 'invalid' },
    ]
    expect(
      rows.toSorted(comparePinnedSessions).map((row) => `${row.id}:${row.environmentId}`),
    ).toEqual(['same:a', 'same:z', 'new:a', 'bad:a'])
    expect(
      rows.toSorted(compareActiveSessions).map((row) => `${row.id}:${row.environmentId}`),
    ).toEqual(['new:a', 'bad:a', 'same:z', 'same:a'])
  })
  test('settled timestamp uses explicit stamp, latest valid turn, then updated time', () => {
    const row = {
      id: 's',
      updatedAt: '2026-01-09',
      latestTurn: { requestedAt: 'invalid', completedAt: '2026-01-03' },
    }
    expect(settledSessionTimestamp({ ...row, settledAt: '2026-01-01' })).toBe('2026-01-01')
    expect(settledSessionTimestamp({ ...row, settledAt: 'invalid' })).toBe('2026-01-03')
    expect(settledSessionTimestamp({ id: 's', updatedAt: 'invalid' })).toBeNull()
  })
})

test('allocation skips hidden keys and materializes only visible rows when neighbors lack keys', () => {
  expect(
    planRailReorder({
      orderedIds: ['moved'],
      movedId: 'moved',
      keysById: new Map([['hidden', 'n']]),
    }),
  ).toEqual([{ id: 'moved', orderKey: 'u' }])
  const assignments = planRailReorder({
    orderedIds: ['first', 'moved', 'last'],
    movedId: 'moved',
    keysById: new Map([
      ['hidden', 'n'],
      ['first', null],
      ['last', null],
    ]),
  })
  expect(assignments.map((row) => row.id)).toEqual(['first', 'moved', 'last'])
  expect(assignments.some((row) => row.orderKey === 'n')).toBe(false)
})

const base = {
  activeKey: 'owner:moved',
  activeSection: 'snoozed' as const,
  activePinned: true,
  activeSettled: true,
  pinnedOrder: ['owner:first'],
  activeOrder: [],
  pinnedKeysById: new Map([
    ['owner:first', null],
    ['owner:moved', 'b'],
  ]),
  activeKeysById: new Map<string, string | null>(),
}

test('retained snoozed pin gets its own reorder write and unsupported materialized neighbor rejects the whole plan', () => {
  const target = {
    section: 'pinned' as const,
    pinnedOrder: ['owner:first', 'owner:moved'],
    activeOrder: [],
  }
  const plan = planRailDrop({ ...base, target })
  expect(plan.kind).toBe('pin')
  if (plan.kind !== 'pin') return
  expect(plan.extraAssignments.map((row) => row.id)).toEqual(['owner:first', 'owner:moved'])
  expect(planRailDrop({ ...base, target, reorderableKeys: new Set(['owner:moved']) })).toEqual({
    kind: 'none',
  })
})

test('moving snoozed retained state to active clears each lifecycle flag; settlement capability gates drop', () => {
  const target = { section: 'active' as const, pinnedOrder: [], activeOrder: ['owner:moved'] }
  expect(planRailDrop({ ...base, target })).toMatchObject({
    kind: 'move-active',
    unpin: true,
    unsettle: true,
    unsnooze: true,
  })
  expect(planRailDrop({ ...base, target, supportsSettlement: false })).toEqual({ kind: 'none' })
  expect(
    planRailDrop({ ...base, activeSection: 'settled', target: { ...target, section: 'settled' } }),
  ).toEqual({ kind: 'none' })
})

test('empty shelves have structural targets and snoozed rejects incoming drops', () => {
  const items: RailListItem[] = [
    { kind: 'marker', marker: 'pinned-header' },
    { kind: 'marker', marker: 'pinned-divider' },
    { kind: 'marker', marker: 'active-placeholder' },
    { kind: 'marker', marker: 'snoozed-header' },
    { kind: 'session', key: 'owner:moved', section: 'snoozed' },
    { kind: 'marker', marker: 'settled-header' },
    { kind: 'marker', marker: 'settled-placeholder' },
  ]
  expect(resolveRailDropTarget(items, 'owner:moved', railMarkerId('pinned-header'))?.section).toBe(
    'pinned',
  )
  expect(
    resolveRailDropTarget(items, 'owner:moved', railMarkerId('active-placeholder'))?.section,
  ).toBe('active')
  expect(
    resolveRailDropTarget(items, 'owner:moved', railMarkerId('settled-placeholder'))?.section,
  ).toBe('settled')
  expect(resolveRailDropTarget(items, 'owner:moved', 'owner:moved')).toBeNull()
})
