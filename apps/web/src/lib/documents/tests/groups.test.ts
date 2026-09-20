import { test, expect } from '../../../../test/fixtures'
import {
  groupBranch,
  groupLeaf,
  groupPlacementIds,
  groupTab,
  groupTree,
} from '../../../../test/factories/editor-groups'
import { documentTargets } from '../../../../test/factories/document-targets'
import {
  activeEditorGroup,
  activeEditorTab,
  allEditorGroups,
  allEditorTabs,
  closeTabInGroups,
  createEditorGroups,
  filterGroupTabs,
  groupById,
  normalizeEditorGroups,
  openTabInGroups,
  placeTabInGroups,
  resizeEditorGroups,
  selectEditorGroupTab,
  validEditorGroups,
} from '@/lib/documents/utils/groups'
import { groupId, splitId } from '@/lib/documents/utils/group-types'
import { tabId } from '@/lib/documents/utils/identity'
import { canSplitGroup, minimumGroupSize } from '@/lib/documents/utils/group-layout'

test('moves the exact tab into a split and selects its source neighbor', () => {
  const a = groupTab('a')
  const b = groupTab('b')
  const c = groupTab('c')
  const groups = groupTree(groupLeaf('main', [a, b, c], b.id), 'main')
  const result = placeTabInGroups(
    groups,
    {
      tabId: b.id,
      mode: 'move',
      target: { kind: 'edge', groupId: groupId('main'), edge: 'right' },
    },
    groupPlacementIds('right'),
  )

  expect(result.status).toBe('applied')
  expect(allEditorGroups(result.groups).map((group) => group.tabs)).toEqual([[a, c], [b]])
  expect(groupById(result.groups, groupId('main'))?.selectedTabId).toBe(c.id)
  expect(activeEditorTab(result.groups)).toBe(b)
  expect(result).toMatchObject({ removedTabIds: [], copiedFromTabId: null })
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('rejects the only-tab self move but permits a separate copied view', () => {
  const a = groupTab('a')
  const groups = groupTree(groupLeaf('main', [a]), 'main')
  const target = { kind: 'edge', groupId: groupId('main'), edge: 'bottom' } as const
  const rejected = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'move', target },
    groupPlacementIds('down'),
  )
  const copied = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'copy', target },
    groupPlacementIds('down'),
  )

  expect(rejected).toMatchObject({ status: 'rejected', reason: 'only-tab-self-move' })
  expect(rejected.groups).toBe(groups)
  expect(copied).toMatchObject({ status: 'applied', copiedFromTabId: a.id })
  expect(allEditorTabs(copied.groups).map((tab) => tab.id)).toEqual([a.id, tabId('tab-down')])
  expect(allEditorTabs(copied.groups).every((tab) => tab.content === a.content)).toBe(true)
  expect(validEditorGroups(copied.groups)).toBe(true)
})

test('inserts an equal-axis split without resizing unrelated siblings', () => {
  const a = groupTab('a')
  const left = groupLeaf('left', [a])
  const right = groupLeaf('right', [groupTab('b')])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: left, size: 30 },
      { node: right, size: 70 },
    ]),
    'left',
  )
  const result = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'copy', target: { kind: 'edge', groupId: right.id, edge: 'right' } },
    groupPlacementIds('third'),
  )

  expect(result.groups.root).toMatchObject({
    kind: 'split',
    id: splitId('row'),
    children: [
      { node: { id: left.id }, size: 30 },
      { node: { id: right.id }, size: 35 },
      { node: { id: groupId('group-third') }, size: 35 },
    ],
  })
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('keeps perpendicular nested splits and collapses an emptied source', () => {
  const a = groupTab('a')
  const left = groupLeaf('left', [a])
  const upper = groupLeaf('upper', [groupTab('b')])
  const lower = groupLeaf('lower', [groupTab('c')])
  const column = groupBranch('column', 'vertical', [
    { node: upper, size: 40 },
    { node: lower, size: 60 },
  ])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: left, size: 30 },
      { node: column, size: 70 },
    ]),
    'left',
  )
  const result = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'move', target: { kind: 'group', groupId: lower.id } },
    groupPlacementIds('unused'),
  )

  expect(result.groups.root).toMatchObject({
    kind: 'split',
    id: column.id,
    axis: 'vertical',
    children: [{ size: 40 }, { size: 60 }],
  })
  expect(allEditorGroups(result.groups).map((group) => group.tabs.map((tab) => tab.id))).toEqual([
    [tabId('b')],
    [tabId('c'), a.id],
  ])
  expect(result.groups.activeGroupId).toBe(lower.id)
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('redistributes an emptied sibling before dividing the destination share', () => {
  const a = groupLeaf('a-group', [groupTab('a')])
  const moved = groupTab('b')
  const b = groupLeaf('b-group', [moved])
  const c = groupLeaf('c-group', [groupTab('c')])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: a, size: 20 },
      { node: b, size: 30 },
      { node: c, size: 50 },
    ]),
    b.id,
  )
  const result = placeTabInGroups(
    groups,
    { tabId: moved.id, mode: 'move', target: { kind: 'edge', groupId: a.id, edge: 'right' } },
    groupPlacementIds('moved'),
  )

  expect(result.status).toBe('applied')
  expect(result.groups.root.kind).toBe('split')
  if (result.groups.root.kind !== 'split') expect.unreachable('Expected a horizontal split')
  expect(result.groups.root.children.map(({ size }) => size)).toEqual([
    expect.closeTo(100 / 7),
    expect.closeTo(100 / 7),
    expect.closeTo(500 / 7),
  ])
  expect(activeEditorTab(result.groups)).toBe(moved)
  expect(groupById(result.groups, b.id)).toBeUndefined()
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('flattens same-axis branches exposed by closing a nested neighbor', () => {
  const a = groupLeaf('a-group', [groupTab('a')])
  const b = groupLeaf('b-group', [groupTab('b')])
  const c = groupLeaf('c-group', [groupTab('c')])
  const d = groupLeaf('d-group', [groupTab('d')])
  const innerRow = groupBranch('inner-row', 'horizontal', [
    { node: b, size: 25 },
    { node: c, size: 75 },
  ])
  const column = groupBranch('column', 'vertical', [
    { node: innerRow, size: 50 },
    { node: d, size: 50 },
  ])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: a, size: 40 },
      { node: column, size: 60 },
    ]),
    d.id,
  )
  const closed = closeTabInGroups(groups, tabId('d'))

  expect(closed.root).toMatchObject({
    kind: 'split',
    axis: 'horizontal',
    children: [
      { node: { id: a.id }, size: 40 },
      { node: { id: b.id }, size: 15 },
      { node: { id: c.id }, size: 45 },
    ],
  })
  expect(validEditorGroups(closed)).toBe(true)
})

test('deduplicates into the resident view and honors a strip anchor', () => {
  const sourceTab = groupTab('source', '/repo/shared.ts')
  const resident = groupTab('resident', '/repo/shared.ts')
  const b = groupTab('b')
  const c = groupTab('c')
  const source = groupLeaf('source-group', [sourceTab])
  const destination = groupLeaf('destination', [b, c, resident])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: source, size: 50 },
      { node: destination, size: 50 },
    ]),
    source.id,
  )
  const result = placeTabInGroups(
    groups,
    {
      tabId: sourceTab.id,
      mode: 'move',
      target: { kind: 'strip', groupId: destination.id, beforeTabId: c.id },
    },
    groupPlacementIds('unused'),
  )

  expect(result).toMatchObject({
    status: 'applied',
    tabId: resident.id,
    removedTabIds: [sourceTab.id],
    copiedFromTabId: null,
  })
  expect(result.groups.root).toMatchObject({ kind: 'group', id: destination.id })
  expect(allEditorTabs(result.groups)).toEqual([b, resident, c])
  expect(activeEditorTab(result.groups)).toBe(resident)
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('a center copy reuses the resident without changing order or source membership', () => {
  const sourceTab = groupTab('source', '/repo/shared.ts')
  const resident = groupTab('resident', '/repo/shared.ts')
  const source = groupLeaf('source-group', [sourceTab])
  const destination = groupLeaf('destination', [resident, groupTab('b')])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: source, size: 50 },
      { node: destination, size: 50 },
    ]),
    source.id,
  )
  const result = placeTabInGroups(
    groups,
    { tabId: sourceTab.id, mode: 'copy', target: { kind: 'group', groupId: destination.id } },
    groupPlacementIds('unused'),
  )

  expect(result).toMatchObject({
    status: 'applied',
    tabId: resident.id,
    copiedFromTabId: null,
    removedTabIds: [],
  })
  expect(allEditorTabs(result.groups)).toEqual([sourceTab, resident, destination.tabs[1]])
  expect(validEditorGroups(result.groups)).toBe(true)
})

test('same-group copy reorders by anchors in both directions without new views', () => {
  const a = groupTab('a')
  const b = groupTab('b')
  const c = groupTab('c')
  const group = groupLeaf('main', [a, b, c])
  const groups = groupTree(group, group.id)
  const movedRight = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'copy', target: { kind: 'strip', groupId: group.id, beforeTabId: c.id } },
    groupPlacementIds('unused'),
  )
  const movedLeft = placeTabInGroups(
    movedRight.groups,
    { tabId: c.id, mode: 'copy', target: { kind: 'strip', groupId: group.id, beforeTabId: b.id } },
    groupPlacementIds('unused'),
  )

  expect(allEditorTabs(movedRight.groups)).toEqual([b, a, c])
  expect(allEditorTabs(movedLeft.groups)).toEqual([c, b, a])
  expect(movedLeft).toMatchObject({ copiedFromTabId: null })
  expect(validEditorGroups(movedLeft.groups)).toBe(true)
})

test('copying onto an already selected resident preserves the exact group state', () => {
  const sourceTab = groupTab('source', '/repo/shared.ts')
  const resident = groupTab('resident', '/repo/shared.ts')
  const source = groupLeaf('source-group', [sourceTab])
  const destination = groupLeaf('destination', [resident])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: source, size: 50 },
      { node: destination, size: 50 },
    ]),
    destination.id,
  )
  const result = placeTabInGroups(
    groups,
    { tabId: sourceTab.id, mode: 'copy', target: { kind: 'group', groupId: destination.id } },
    groupPlacementIds('unused'),
  )

  expect(result.status).toBe('unchanged')
  expect(result.groups).toBe(groups)
})

test('copying a tab before its existing neighbor preserves its view and order', () => {
  const a = groupTab('a')
  const b = groupTab('b')
  const group = groupLeaf('main', [a, b], a.id)
  const groups = groupTree(group, group.id)
  const result = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'copy', target: { kind: 'strip', groupId: group.id, beforeTabId: b.id } },
    groupPlacementIds('unused'),
  )

  expect(result.status).toBe('unchanged')
  expect(result.groups).toBe(groups)
})

test('rejects stale targets and leaves own-center drops unchanged', () => {
  const a = groupTab('a')
  const group = groupLeaf('main', [a])
  const groups = groupTree(group, group.id)
  const ids = groupPlacementIds('unused')
  const missingAnchor = placeTabInGroups(
    groups,
    {
      tabId: a.id,
      mode: 'move',
      target: { kind: 'strip', groupId: group.id, beforeTabId: tabId('gone') },
    },
    ids,
  )
  const missingGroup = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'move', target: { kind: 'group', groupId: groupId('gone') } },
    ids,
  )
  const center = placeTabInGroups(
    groups,
    { tabId: a.id, mode: 'copy', target: { kind: 'group', groupId: group.id } },
    ids,
  )

  expect(missingAnchor).toMatchObject({ status: 'superseded' })
  expect(missingGroup).toMatchObject({ status: 'superseded' })
  expect(center).toEqual({ status: 'unchanged', groups })
})

test('rejects singleton copies without turning them into moves', () => {
  for (const content of [documentTargets.settings, documentTargets.search]) {
    const tab = groupTab('tool', content)
    const group = groupLeaf('main', [tab, groupTab('a')])
    const groups = groupTree(group, group.id)
    const result = placeTabInGroups(
      groups,
      { tabId: tab.id, mode: 'copy', target: { kind: 'edge', groupId: group.id, edge: 'right' } },
      groupPlacementIds('tool'),
    )
    expect(result).toMatchObject({ status: 'rejected', reason: 'content-cannot-copy' })
    expect(result.groups).toBe(groups)
  }
})

test('opens content in the active group and reuses singleton tools across groups', () => {
  const a = groupTab('a')
  const tool = groupTab('settings', documentTargets.settings)
  const left = groupLeaf('left', [a, tool])
  const right = groupLeaf('right', [groupTab('b')])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: left, size: 50 },
      { node: right, size: 50 },
    ]),
    right.id,
  )
  const opened = openTabInGroups(groups, groupTab('second-a', '/repo/a.ts'))
  const settings = openTabInGroups(opened, groupTab('second-settings', documentTargets.settings))

  expect(groupById(opened, right.id)?.tabs.map((tab) => tab.id)).toEqual([
    tabId('b'),
    tabId('second-a'),
  ])
  expect(settings.activeGroupId).toBe(left.id)
  expect(activeEditorTab(settings)).toBe(tool)
  expect(allEditorTabs(settings)).toHaveLength(4)
})

test('preserves explicit null selections and retains one empty group after all views close', () => {
  const group = groupLeaf('main', [groupTab('a'), groupTab('b')])
  const groups = groupTree(group, group.id)
  const cleared = selectEditorGroupTab(groups, group.id, null)
  const retained = filterGroupTabs(cleared, (tab) => tab.id !== tabId('b'))
  const empty = closeTabInGroups(retained, tabId('a'))

  expect(activeEditorTab(normalizeEditorGroups(retained))).toBeNull()
  expect(activeEditorGroup(retained).tabs).toHaveLength(1)
  expect(empty).toEqual(createEditorGroups(group.id))
  expect(validEditorGroups(empty)).toBe(true)
})

test('ignores resize results from a stale topology and rejects invalid shares', () => {
  const left = groupLeaf('left', [groupTab('a')])
  const right = groupLeaf('right', [groupTab('b')])
  const root = groupBranch('row', 'horizontal', [
    { node: left, size: 50 },
    { node: right, size: 50 },
  ])
  const groups = groupTree(root, left.id)
  const stale = resizeEditorGroups(groups, {
    splitId: root.id,
    children: [
      { id: right.id, size: 60 },
      { id: left.id, size: 40 },
    ],
  })
  const invalid = resizeEditorGroups(groups, {
    splitId: root.id,
    children: [
      { id: left.id, size: NaN },
      { id: right.id, size: 40 },
    ],
  })
  const resized = resizeEditorGroups(groups, {
    splitId: root.id,
    children: [
      { id: left.id, size: 3 },
      { id: right.id, size: 2 },
    ],
  })

  expect(stale).toBe(groups)
  expect(invalid).toBe(groups)
  expect(resized.root).toMatchObject({ children: [{ size: 60 }, { size: 40 }] })
  expect(validEditorGroups(resized)).toBe(true)
})

test('validates persisted identity, singleton, and geometry constraints', () => {
  const a = groupTab('a')
  const left = groupLeaf('left', [a])
  const right = groupLeaf('right', [groupTab('b')])
  const root = groupBranch('row', 'horizontal', [
    { node: left, size: 50 },
    { node: right, size: 50 },
  ])
  expect(validEditorGroups(groupTree(root, 'missing'))).toBe(false)
  expect(validEditorGroups(groupTree({ ...left, selectedTabId: tabId('gone') }, left.id))).toBe(
    false,
  )
  expect(
    validEditorGroups(
      groupTree(
        groupBranch('row', 'horizontal', [
          { node: left, size: 50 },
          { node: { ...right, tabs: [a] }, size: 50 },
        ]),
        left.id,
      ),
    ),
  ).toBe(false)
  expect(
    validEditorGroups(
      groupTree(
        groupBranch('row', 'horizontal', [
          { node: left, size: 0 },
          { node: right, size: 100 },
        ]),
        left.id,
      ),
    ),
  ).toBe(false)
  const settings = groupTab('settings', documentTargets.settings)
  expect(
    validEditorGroups(
      groupTree(
        groupBranch('row', 'horizontal', [
          { node: groupLeaf('left', [settings]), size: 50 },
          { node: groupLeaf('right', [{ ...settings, id: tabId('settings-copy') }]), size: 50 },
        ]),
        left.id,
      ),
    ),
  ).toBe(false)
})

test('includes nested divider space in minimum layout dimensions', () => {
  const a = groupLeaf('a-group', [groupTab('a')])
  const b = groupLeaf('b-group', [groupTab('b')])
  const c = groupLeaf('c-group', [groupTab('c')])
  const column = groupBranch('column', 'vertical', [
    { node: b, size: 50 },
    { node: c, size: 50 },
  ])
  const row = groupBranch('row', 'horizontal', [
    { node: a, size: 50 },
    { node: column, size: 50 },
  ])

  expect(minimumGroupSize(row)).toEqual({ width: 484, height: 324 })
  expect(canSplitGroup({ width: 483, height: 324 }, 'right')).toBe(false)
  expect(canSplitGroup({ width: 484, height: 160 }, 'right')).toBe(true)
  expect(canSplitGroup({ width: 240, height: 323 }, 'bottom')).toBe(false)
  expect(canSplitGroup({ width: 240, height: 324 }, 'top')).toBe(true)
})

test('keeps the original state when an edge move would recreate the same layout', () => {
  const a = groupTab('a')
  const b = groupTab('b')
  const left = groupLeaf('left', [a])
  const right = groupLeaf('right', [b])
  const groups = groupTree(
    groupBranch('row', 'horizontal', [
      { node: left, size: 50 },
      { node: right, size: 50 },
    ]),
    'left',
  )
  const result = placeTabInGroups(
    groups,
    {
      tabId: a.id,
      mode: 'move',
      target: { kind: 'edge', groupId: right.id, edge: 'left' },
    },
    groupPlacementIds('same-position'),
  )
  expect(result.status).toBe('unchanged')
  expect(result.groups).toBe(groups)
})

test.each(['move', 'copy'] as const)(
  'keeps the original state for a %s into the current strip position',
  (mode) => {
    const a = groupTab('a')
    const b = groupTab('b')
    const groups = groupTree(groupLeaf('main', [a, b], a.id), 'main')
    const result = placeTabInGroups(
      groups,
      {
        tabId: a.id,
        mode,
        target: { kind: 'strip', groupId: groupId('main'), beforeTabId: b.id },
      },
      groupPlacementIds('same-position'),
    )
    expect(result.status).toBe('unchanged')
    expect(result.groups).toBe(groups)
  },
)
