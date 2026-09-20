import { deepStrictEqual, notDeepStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  compareActiveSessions,
  comparePinnedSessions,
  compareSettledSessions,
  compareSessionsByActivity,
  settledSessionTimestamp,
} from '../../packages/client-core/src/chat/rail/session-order'
import { planRailReorder } from '../../packages/client-core/src/chat/rail/reorder'
import {
  planRailDrop,
  railListItemId,
  resolveRailDropTarget,
  type RailListItem,
  type RailShelf,
} from '../../packages/client-core/src/chat/rail/drop'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(pin, inventory.upstream_commit)
const sortPath = 'packages/client-runtime/src/state/threadSort.ts'
const sidebarPath = 'apps/web/src/components/Sidebar.logic.ts'
const read = (path: string) =>
  execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${path}`], { encoding: 'utf8' })
const sortSource = read(sortPath)
const sidebarSource = read(sidebarPath)
const start = sidebarSource.indexOf('export type SidebarSection =')
const end = sidebarSource.indexOf("/** Project a drop's lifecycle fields", start)
strictEqual(start >= 0 && end > start, true, 'Pinned pure sidebar section must exist')
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  sortSource + '\n' + sidebarSource.slice(start, end),
)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const dates = ['invalid', '1969-12-31T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']
const keys = [null, 'b', 'n', 'z']
const rows = dates.flatMap((createdAt, i) =>
  keys.flatMap((key, j) =>
    ['a', 'z'].map((environmentId) => ({
      id: `session-${i}-${j}`,
      environmentId,
      createdAt,
      updatedAt: dates[(i + 1) % dates.length]!,
      pinOrderKey: key,
      activeOrderKey: key,
      unsettledAt: dates[(i + j) % dates.length],
    })),
  ),
)
let sortingCases = 0
for (let index = 0; index < rows.length; index++) {
  const corpus = [...rows.slice(index), ...rows.slice(0, index)]
  deepStrictEqual(
    corpus.toSorted(comparePinnedSessions),
    upstream.sortPinnedThreadsByOrderKey(corpus),
  )
  deepStrictEqual(
    corpus.toSorted(compareActiveSessions),
    upstream.sortActiveThreadsByOrderKey(corpus),
  )
  sortingCases += 2
}
let navigationSortCases = 0
for (const sortOrder of ['created_at', 'updated_at'] as const) {
  for (let index = 0; index < rows.length; index++) {
    const corpus = [...rows.slice(index), ...rows.slice(0, index)]
    deepStrictEqual(
      corpus.toSorted((left, right) => compareSessionsByActivity(left, right, sortOrder)),
      upstream.sortThreads(corpus, sortOrder),
    )
    navigationSortCases++
  }
}
const equalPins = rows.filter((row) => row.pinOrderKey === 'b')
notDeepStrictEqual(
  equalPins.toSorted(comparePinnedSessions),
  equalPins.toSorted(
    (a, b) =>
      (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id),
  ),
  'Using creation time before identity for equal pin keys must fail',
)
notDeepStrictEqual(
  rows.toSorted(compareActiveSessions),
  upstream.sortPinnedThreadsByOrderKey(rows),
  'Keyed-first active sorting must fail',
)
let settledCases = 0
for (const settledAt of [null, ...dates]) {
  for (const completedAt of [null, ...dates]) {
    for (const updatedAt of dates) {
      const row = {
        id: 's',
        settledAt,
        updatedAt,
        latestUserMessageAt: dates[2],
        latestTurn: { requestedAt: dates[0], startedAt: dates[1], completedAt },
      }
      deepStrictEqual(settledSessionTimestamp(row), upstream.resolveSettledThreadTimestamp(row))
      settledCases++
    }
  }
}
const settledRows = rows.map((row, index) => ({
  ...row,
  id: `settled-${index}`,
  settledAt: dates[index % dates.length],
  latestUserMessageAt: dates[(index + 2) % dates.length],
}))
let settledSortCases = 0
for (let index = 0; index < settledRows.length; index++) {
  const corpus = [...settledRows.slice(index), ...settledRows.slice(0, index)]
  const expected = corpus.toSorted((left, right) => {
    const leftStamp = upstream.resolveSettledThreadTimestamp(left)
    const rightStamp = upstream.resolveSettledThreadTimestamp(right)
    return (
      (Date.parse(rightStamp ?? '') || 0) - (Date.parse(leftStamp ?? '') || 0) ||
      left.id.localeCompare(right.id)
    )
  })
  deepStrictEqual(corpus.toSorted(compareSettledSessions), expected)
  settledSortCases++
}
const keyMaps = [
  new Map<string, string | null>([
    ['a', 'b'],
    ['m', 'n'],
    ['z', 'z'],
  ]),
  new Map<string, string | null>([
    ['a', null],
    ['m', null],
    ['z', null],
  ]),
  new Map<string, string | null>([
    ['a', 'z'],
    ['m', 'n'],
    ['z', 'b'],
  ]),
  new Map<string, string | null>([
    ['a', 'bad-key'],
    ['m', null],
    ['z', 'ba'],
  ]),
]
const orders = [['a', 'm', 'z'], ['m', 'a', 'z'], ['z', 'a', 'm'], ['m'], []]
let allocationCases = 0
for (const keysById of keyMaps) {
  for (const reserved of [[], ['n'], ['b', 'n', 'u', 'z']]) {
    const map = new Map([
      ...keysById,
      ...reserved.map((key, index) => [`hidden${index}`, key] as const),
    ])
    for (const orderedIds of orders) {
      const input = { orderedIds, keysById: map, movedId: 'm' }
      deepStrictEqual(planRailReorder(input), upstream.planPinnedReorder(input))
      allocationCases++
    }
  }
}
const collision = { orderedIds: ['m'], keysById: new Map([['hidden', 'n']]), movedId: 'm' }
notDeepStrictEqual(
  planRailReorder(collision),
  [{ id: 'm', orderKey: 'n' }],
  'Ignoring hidden reservations must fail',
)
const materialize = { orderedIds: ['a', 'm', 'z'], keysById: keyMaps[1]!, movedId: 'm' }
notDeepStrictEqual(
  planRailReorder(materialize),
  [{ id: 'm', orderKey: 'n' }],
  'Keyed-only truncation must fail',
)

const shelves: RailShelf[] = ['pinned', 'active', 'snoozed', 'settled']
let dropCases = 0
for (const activeSection of shelves) {
  for (const section of ['pinned', 'active', 'settled'] as const) {
    for (const keysById of keyMaps) {
      compareDropVariants(activeSection, section, keysById)
    }
  }
}
function compareDropVariants(
  activeSection: RailShelf,
  section: 'pinned' | 'active' | 'settled',
  keysById: ReadonlyMap<string, string | null>,
) {
  for (const activePinned of [false, true]) {
    for (const activeSettled of [false, true]) {
      compareDropCapabilities(activeSection, section, keysById, activePinned, activeSettled)
    }
  }
}
function compareDropCapabilities(
  activeSection: RailShelf,
  section: 'pinned' | 'active' | 'settled',
  keysById: ReadonlyMap<string, string | null>,
  activePinned: boolean,
  activeSettled: boolean,
) {
  for (const supportsSettlement of [false, true]) {
    for (const allowed of [new Set(['a', 'm', 'z']), new Set(['m']), new Set<string>()]) {
      const input = {
        activeKey: 'm',
        activeSection,
        activePinned,
        activeSettled,
        supportsSettlement,
        target: { section, pinnedOrder: ['a', 'm', 'z'], activeOrder: ['z', 'm', 'a'] },
        pinnedOrder: ['m', 'a', 'z'],
        activeOrder: ['a', 'z', 'm'],
        pinnedKeysById: keysById,
        activeKeysById: keysById,
        reorderableKeys: allowed,
        activeReorderableKeys: allowed,
      }
      deepStrictEqual(planRailDrop(input), upstream.planSidebarThreadDrop(input))
      dropCases++
    }
  }
}
const retainedPin = {
  activeKey: 'm',
  activeSection: 'snoozed' as const,
  activePinned: true,
  target: { section: 'pinned' as const, pinnedOrder: ['m'], activeOrder: [] },
  pinnedOrder: [],
  activeOrder: [],
  pinnedKeysById: new Map([['m', 'b']]),
  activeKeysById: new Map<string, string | null>(),
}
const retainedPlan = planRailDrop(retainedPin)
strictEqual(retainedPlan.kind, 'pin')
if (retainedPlan.kind === 'pin')
  notDeepStrictEqual(
    retainedPlan.extraAssignments,
    [],
    'Retained snoozed pin must receive explicit key assignment',
  )
const unsupported = {
  ...retainedPin,
  target: { ...retainedPin.target, pinnedOrder: ['a', 'm'] },
  pinnedKeysById: new Map<string, string | null>(),
  reorderableKeys: new Set(['m']),
}
deepStrictEqual(planRailDrop(unsupported), { kind: 'none' })
notDeepStrictEqual(
  planRailDrop({ ...unsupported, reorderableKeys: new Set(['a', 'm']) }),
  { kind: 'none' },
  'Unsupported materialized neighbor must reject whole plan',
)
let targetCases = 0
for (const populated of [false, true]) {
  const items: RailListItem[] = [
    { kind: 'marker', marker: 'pinned-header' },
    ...(populated
      ? [{ kind: 'session' as const, key: 'owner:p', section: 'pinned' as const }]
      : []),
    { kind: 'marker', marker: 'pinned-divider' },
    { kind: 'marker', marker: 'active-placeholder' },
    ...(populated
      ? [{ kind: 'session' as const, key: 'owner:a', section: 'active' as const }]
      : []),
    { kind: 'marker', marker: 'snoozed-header' },
    { kind: 'session', key: 'owner:s', section: 'snoozed' },
    { kind: 'marker', marker: 'settled-header' },
    { kind: 'marker', marker: 'settled-placeholder' },
    ...(populated
      ? [{ kind: 'session' as const, key: 'owner:d', section: 'settled' as const }]
      : []),
  ]
  for (const item of items) {
    for (const over of items) {
      const oldItems = items.map((entry) =>
        entry.kind === 'session' ? { ...entry, kind: 'thread' } : entry,
      )
      deepStrictEqual(
        resolveRailDropTarget(items, railListItemId(item), railListItemId(over)),
        upstream.resolveSidebarDropTarget(
          oldItems,
          railListItemId(item).replace('rail-marker-', 'sidebar-marker-'),
          railListItemId(over).replace('rail-marker-', 'sidebar-marker-'),
        ),
      )
      targetCases++
    }
  }
}
console.log(
  JSON.stringify({
    pin,
    sortPath,
    sidebarPath,
    sortingCases,
    navigationSortCases,
    settledCases,
    settledSortCases,
    allocationCases,
    dropCases,
    targetCases,
    negativeControls: 6,
    result: 'matched',
    scope: 'Pure policies only; no persisted or UI ordering parity claim',
  }),
)
