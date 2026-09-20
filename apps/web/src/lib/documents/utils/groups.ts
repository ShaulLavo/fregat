import { groupSplitAxis } from '@/lib/documents/utils/group-layout'
import {
  createGroupId,
  type EditorGroup,
  type EditorGroups,
  type EditorSplit,
  type GroupId,
  type GroupNode,
  type GroupResize,
  type PlacementIds,
  type SplitChild,
  type TabPlacement,
  type TabPlacementResult,
} from '@/lib/documents/utils/group-types'
import { sameTabContent, tabContentKey } from '@/lib/documents/utils/tabs'
import type { EditorTabRecord, TabContent, TabId } from '@/lib/documents/utils/types'

export function createEditorGroups(id: GroupId = createGroupId()): EditorGroups {
  return { root: { kind: 'group', id, tabs: [], selectedTabId: null }, activeGroupId: id }
}

export function allEditorGroups(groups: EditorGroups): readonly EditorGroup[] {
  return leafGroups(groups.root)
}

function leafGroups(node: GroupNode): readonly EditorGroup[] {
  if (node.kind === 'group') return [node]
  return node.children.flatMap((child) => leafGroups(child.node))
}

export function allEditorTabs(groups: EditorGroups): readonly EditorTabRecord[] {
  return allEditorGroups(groups).flatMap((group) => group.tabs)
}

export function groupById(groups: EditorGroups, id: GroupId): EditorGroup | undefined {
  return allEditorGroups(groups).find((group) => group.id === id)
}

export function groupForTab(groups: EditorGroups, tabId: TabId): EditorGroup | undefined {
  return allEditorGroups(groups).find((group) => group.tabs.some((tab) => tab.id === tabId))
}

function firstGroup(node: GroupNode): EditorGroup {
  if (node.kind === 'group') return node
  return firstGroup(node.children[0].node)
}

export function activeEditorGroup(groups: EditorGroups): EditorGroup {
  return groupById(groups, groups.activeGroupId) ?? firstGroup(groups.root)
}

export function activeEditorTab(groups: EditorGroups): EditorTabRecord | null {
  const group = activeEditorGroup(groups)
  return group.tabs.find((tab) => tab.id === group.selectedTabId) ?? null
}

export function canCopyTabContent(content: TabContent): boolean {
  return content.kind === 'document' && content.document.kind !== 'search'
}

export function selectEditorGroup(groups: EditorGroups, id: GroupId): EditorGroups {
  if (groups.activeGroupId === id || !groupById(groups, id)) return groups
  return { ...groups, activeGroupId: id }
}

export function selectEditorGroupTab(
  groups: EditorGroups,
  groupId: GroupId,
  tabId: TabId | null,
): EditorGroups {
  const group = groupById(groups, groupId)
  if (!group || (tabId !== null && !group.tabs.some((tab) => tab.id === tabId))) return groups
  if (group.selectedTabId === tabId) return selectEditorGroup(groups, groupId)

  const root = replaceNode(groups.root, groupId, { ...group, selectedTabId: tabId })
  return { root, activeGroupId: groupId }
}

export function openTabInGroups(
  groups: EditorGroups,
  tab: EditorTabRecord,
  groupId: GroupId = groups.activeGroupId,
): EditorGroups {
  const group = groupById(groups, groupId)
  if (!group) return groups

  const existingGroup = existingTabGroup(groups, group, tab)
  const existing = existingGroup?.tabs.find((item) => sameTabContent(item.content, tab.content))
  if (existing && existingGroup) return selectEditorGroupTab(groups, existingGroup.id, existing.id)
  if (groupForTab(groups, tab.id)) return groups

  const root = replaceNode(groups.root, groupId, {
    ...group,
    tabs: [...group.tabs, tab],
    selectedTabId: tab.id,
  })
  return { root, activeGroupId: groupId }
}

function existingTabGroup(groups: EditorGroups, group: EditorGroup, tab: EditorTabRecord) {
  if (canCopyTabContent(tab.content)) return group
  return allEditorGroups(groups).find((candidate) =>
    candidate.tabs.some((item) => sameTabContent(item.content, tab.content)),
  )
}

export function closeTabInGroups(groups: EditorGroups, tabId: TabId): EditorGroups {
  return filterGroupTabs(groups, (tab) => tab.id !== tabId)
}

export function filterGroupTabs(
  groups: EditorGroups,
  predicate: (tab: EditorTabRecord) => boolean,
): EditorGroups {
  const root = mapLeaves(groups.root, (group) => withTabs(group, group.tabs.filter(predicate)))
  if (root === groups.root) return groups
  return normalizeEditorGroups({ ...groups, root })
}

export function mapGroupTabs(
  groups: EditorGroups,
  mapper: (tab: EditorTabRecord) => EditorTabRecord,
): EditorGroups {
  const root = mapLeaves(groups.root, (group) => withTabs(group, group.tabs.map(mapper)))
  if (root === groups.root) return groups
  return normalizeEditorGroups({ ...groups, root })
}

function withTabs(group: EditorGroup, tabs: readonly EditorTabRecord[]): EditorGroup {
  if (sameItems(group.tabs, tabs)) return group
  if (group.selectedTabId === null) return { ...group, tabs }
  if (tabs.some((tab) => tab.id === group.selectedTabId)) return { ...group, tabs }

  const previousIndex = group.tabs.findIndex((tab) => tab.id === group.selectedTabId)
  const selectedTabId = tabs[Math.min(Math.max(previousIndex, 0), tabs.length - 1)]?.id ?? null
  return { ...group, tabs, selectedTabId }
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function mapLeaves(node: GroupNode, mapper: (group: EditorGroup) => EditorGroup): GroupNode {
  if (node.kind === 'group') return mapper(node)
  const children = node.children.map((child) => {
    const next = mapLeaves(child.node, mapper)
    return next === child.node ? child : { ...child, node: next }
  })
  return withChildren(node, children)
}

function replaceNode(node: GroupNode, id: GroupNode['id'], replacement: GroupNode): GroupNode {
  if (node.id === id) return replacement
  if (node.kind === 'group') return node
  const children = node.children.map((child) => {
    const next = replaceNode(child.node, id, replacement)
    return next === child.node ? child : { ...child, node: next }
  })
  return withChildren(node, children)
}

function withChildren(node: EditorSplit, children: readonly SplitChild[]): GroupNode {
  if (sameItems(node.children, children)) return node
  const [first, second, ...rest] = children
  if (!first) return node
  if (!second) return first.node
  return { ...node, children: [first, second, ...rest] }
}

export function normalizeEditorGroups(groups: EditorGroups): EditorGroups {
  const normalized = normalizeNode(groups.root)
  if (!normalized) return emptyActiveGroup(groups)
  const leaves = leafGroups(normalized)
  const active = leaves.find((group) => group.id === groups.activeGroupId)
  const activeGroupId = active?.id ?? neighboringGroupId(groups, leaves)
  if (normalized === groups.root && activeGroupId === groups.activeGroupId) return groups
  return { root: normalized, activeGroupId }
}

function emptyActiveGroup(groups: EditorGroups): EditorGroups {
  const group = activeEditorGroup(groups)
  if (
    groups.root === group &&
    group.tabs.length === 0 &&
    group.selectedTabId === null &&
    groups.activeGroupId === group.id
  )
    return groups
  return createEditorGroups(group.id)
}

function neighboringGroupId(groups: EditorGroups, leaves: readonly EditorGroup[]): GroupId {
  const oldIndex = allEditorGroups(groups).findIndex((group) => group.id === groups.activeGroupId)
  return (
    leaves[Math.min(Math.max(oldIndex, 0), leaves.length - 1)]?.id ?? firstGroup(groups.root).id
  )
}

function normalizeNode(node: GroupNode): GroupNode | null {
  if (node.kind === 'group') return normalizeLeaf(node)
  const children = node.children.flatMap((child) => normalizedChildren(child, node.axis))
  if (children.length === 0) return null
  const total = children.reduce((sum, child) => sum + child.size, 0)
  const shares = children.map((child) => {
    const size = (child.size / total) * 100
    return Math.abs(size - child.size) < 1e-10 ? child : { ...child, size }
  })
  return withChildren(node, shares)
}

function normalizedChildren(child: SplitChild, axis: EditorSplit['axis']): readonly SplitChild[] {
  const node = normalizeNode(child.node)
  if (!node) return []
  if (node.kind === 'split' && node.axis === axis) {
    return node.children.map((nested) => ({
      node: nested.node,
      size: (child.size * nested.size) / 100,
    }))
  }
  return [node === child.node ? child : { ...child, node }]
}

function normalizeLeaf(group: EditorGroup): EditorGroup | null {
  if (group.tabs.length === 0) return null
  const tabs = uniqueGroupTabs(group)
  const selectedTabId = normalizedSelection(group.selectedTabId, tabs)
  if (tabs === group.tabs && selectedTabId === group.selectedTabId) return group
  return { ...group, tabs, selectedTabId }
}

function uniqueGroupTabs(group: EditorGroup): readonly EditorTabRecord[] {
  const byContent = new Map<string, EditorTabRecord>()
  for (const tab of group.tabs) {
    const key = tabContentKey(tab.content)
    if (byContent.has(key) && tab.id !== group.selectedTabId) continue
    byContent.set(key, tab)
  }
  if (byContent.size === group.tabs.length) return group.tabs
  return [...byContent.values()]
}

function normalizedSelection(selected: TabId | null, tabs: readonly EditorTabRecord[]) {
  if (selected === null || tabs.some((tab) => tab.id === selected)) return selected
  return tabs[0]?.id ?? null
}

export function placeTabInGroups(
  groups: EditorGroups,
  placement: TabPlacement,
  ids: PlacementIds,
): TabPlacementResult {
  const source = groupForTab(groups, placement.tabId)
  const tab = source?.tabs.find((item) => item.id === placement.tabId)
  const destination = groupById(groups, placement.target.groupId)
  if (!source || !tab || !destination) {
    return { status: 'superseded', groups, reason: 'missing-tab-or-group' }
  }
  const rejection = placementRejection(groups, placement, source, destination, tab)
  if (rejection) return rejection
  if (placement.target.kind === 'edge') {
    return splitPlacement(groups, placement, source, destination, tab, ids)
  }
  return groupPlacement(groups, placement, source, destination, tab, ids)
}

function placementRejection(
  groups: EditorGroups,
  placement: TabPlacement,
  source: EditorGroup,
  destination: EditorGroup,
  tab: EditorTabRecord,
): TabPlacementResult | null {
  if (placement.mode === 'copy' && !canCopyTabContent(tab.content)) {
    return { status: 'rejected', groups, reason: 'content-cannot-copy' }
  }
  const target = placement.target
  if (target.kind === 'strip' && target.beforeTabId !== null) {
    if (!destination.tabs.some((item) => item.id === target.beforeTabId))
      return { status: 'superseded', groups, reason: 'missing-insertion-anchor' }
    if (target.beforeTabId === tab.id) return { status: 'unchanged', groups }
  }
  if (source.id !== destination.id) return null
  if (target.kind === 'group') return { status: 'unchanged', groups }
  if (target.kind === 'edge' && placement.mode === 'move' && source.tabs.length === 1) {
    return { status: 'rejected', groups, reason: 'only-tab-self-move' }
  }
  return null
}

function groupPlacement(
  groups: EditorGroups,
  placement: TabPlacement,
  source: EditorGroup,
  destination: EditorGroup,
  tab: EditorTabRecord,
  ids: PlacementIds,
): TabPlacementResult {
  const resident = destination.tabs.find((item) => sameTabContent(item.content, tab.content))
  const copied = placement.mode === 'copy' && !resident
  if (copied && nodeIdentityExists(groups, ids.tabId)) {
    return { status: 'rejected', groups, reason: 'duplicate-identity' }
  }
  const placed = resident ?? (copied ? { ...tab, id: ids.tabId } : tab)
  const root = mapLeaves(groups.root, (group) => {
    if (group.id === destination.id) return insertTab(group, placed, placement.target)
    if (group.id !== source.id || placement.mode === 'copy') return group
    return withTabs(
      group,
      group.tabs.filter((item) => item.id !== tab.id),
    )
  })
  const next = normalizeEditorGroups({ root, activeGroupId: destination.id })
  const removedTabIds =
    resident && placement.mode === 'move' && source.id !== destination.id ? [tab.id] : []
  return placementResult(
    groups,
    next,
    destination.id,
    placed.id,
    removedTabIds,
    copied ? tab.id : null,
  )
}

function insertTab(
  group: EditorGroup,
  tab: EditorTabRecord,
  target: TabPlacement['target'],
): EditorGroup {
  const existing = group.tabs.some((item) => item.id === tab.id)
  if (existing && target.kind !== 'strip') return selectedGroup(group, tab.id)
  if (target.kind === 'strip' && target.beforeTabId === tab.id) return selectedGroup(group, tab.id)
  const tabs = group.tabs.filter((item) => item.id !== tab.id)
  const before = target.kind === 'strip' ? target.beforeTabId : null
  const index = before === null ? tabs.length : tabs.findIndex((item) => item.id === before)
  tabs.splice(index, 0, tab)
  return selectedGroup(withTabs(group, tabs), tab.id)
}

function selectedGroup(group: EditorGroup, selectedTabId: TabId): EditorGroup {
  if (group.selectedTabId === selectedTabId) return group
  return { ...group, selectedTabId }
}

function splitPlacement(
  groups: EditorGroups,
  placement: TabPlacement,
  source: EditorGroup,
  destination: EditorGroup,
  tab: EditorTabRecord,
  ids: PlacementIds,
): TabPlacementResult {
  if (placement.target.kind !== 'edge') return { status: 'unchanged', groups }
  const copied = placement.mode === 'copy'
  const freshIds = copied ? [ids.groupId, ids.splitId, ids.tabId] : [ids.groupId, ids.splitId]
  if (
    new Set(freshIds).size !== freshIds.length ||
    freshIds.some((id) => nodeIdentityExists(groups, id))
  ) {
    return { status: 'rejected', groups, reason: 'duplicate-identity' }
  }
  const placed = copied ? { ...tab, id: ids.tabId } : tab
  const newGroup: EditorGroup = {
    kind: 'group',
    id: ids.groupId,
    tabs: [placed],
    selectedTabId: placed.id,
  }
  const root = mapLeaves(groups.root, (group) => {
    if (group.id !== source.id || copied) return group
    return withTabs(
      group,
      group.tabs.filter((item) => item.id !== tab.id),
    )
  })
  const target = groupById({ root, activeGroupId: destination.id }, destination.id)
  if (!target) return { status: 'superseded', groups, reason: 'missing-target-group' }
  const before = placement.target.edge === 'left' || placement.target.edge === 'top'
  const split: EditorSplit = {
    kind: 'split',
    id: ids.splitId,
    axis: groupSplitAxis(placement.target.edge),
    children: [
      { node: before ? newGroup : target, size: 50 },
      { node: before ? target : newGroup, size: 50 },
    ],
  }
  const next = normalizeEditorGroups({
    root: replaceNode(root, target.id, split),
    activeGroupId: newGroup.id,
  })
  return placementResult(groups, next, newGroup.id, placed.id, [], copied ? tab.id : null)
}

function placementResult(
  previous: EditorGroups,
  groups: EditorGroups,
  groupId: GroupId,
  tabId: TabId,
  removedTabIds: readonly TabId[],
  copiedFromTabId: TabId | null,
): TabPlacementResult {
  if (samePlacementState(previous, groups)) {
    return { status: 'unchanged', groups: previous }
  }
  return { status: 'applied', groups, groupId, tabId, removedTabIds, copiedFromTabId }
}

function samePlacementState(previous: EditorGroups, next: EditorGroups): boolean {
  if (!samePlacementNode(previous.root, next.root)) return false
  const previousIndex = allEditorGroups(previous).findIndex(
    (group) => group.id === previous.activeGroupId,
  )
  const nextIndex = allEditorGroups(next).findIndex((group) => group.id === next.activeGroupId)
  return previousIndex === nextIndex
}

function samePlacementNode(previous: GroupNode, next: GroupNode): boolean {
  if (previous === next) return true
  if (previous.kind === 'group' && next.kind === 'group')
    return previous.selectedTabId === next.selectedTabId && sameItems(previous.tabs, next.tabs)
  if (previous.kind !== 'split' || next.kind !== 'split' || previous.axis !== next.axis)
    return false
  if (previous.children.length !== next.children.length) return false
  return previous.children.every((child, index) => {
    const other = next.children[index]
    return (
      other !== undefined &&
      Math.abs(child.size - other.size) < 1e-6 &&
      samePlacementNode(child.node, other.node)
    )
  })
}

function nodeIdentityExists(groups: EditorGroups, id: string): boolean {
  return identityInNode(groups.root, id)
}

function identityInNode(node: GroupNode, id: string): boolean {
  if (node.id === id) return true
  if (node.kind === 'group') return node.tabs.some((tab) => tab.id === id)
  return node.children.some((child) => identityInNode(child.node, id))
}

export function resizeEditorGroups(groups: EditorGroups, resize: GroupResize): EditorGroups {
  const root = resizeNode(groups.root, resize)
  if (root === groups.root) return groups
  return { ...groups, root }
}

function resizeNode(node: GroupNode, resize: GroupResize): GroupNode {
  if (node.kind === 'group') return node
  if (node.id === resize.splitId) return resizedSplit(node, resize)
  const children = node.children.map((child) => {
    const next = resizeNode(child.node, resize)
    return next === child.node ? child : { ...child, node: next }
  })
  return withChildren(node, children)
}

function resizedSplit(node: EditorSplit, resize: GroupResize): GroupNode {
  if (resize.children.length !== node.children.length) return node
  if (
    !resize.children.every(
      (child, index) =>
        child.id === node.children[index]?.node.id && Number.isFinite(child.size) && child.size > 0,
    )
  )
    return node
  const total = resize.children.reduce((sum, child) => sum + child.size, 0)
  if (!Number.isFinite(total)) return node
  const children = node.children.map((child, index) => {
    const requested = resize.children[index]
    if (!requested) return child
    const size = (requested.size / total) * 100
    return Math.abs(size - child.size) < 1e-10 ? child : { ...child, size }
  })
  return withChildren(node, children)
}

export function validEditorGroups(groups: EditorGroups): boolean {
  const identities = new Set<string>()
  const singletons = new Set<string>()
  return (
    validNode(groups.root, null, identities, singletons, true) &&
    groupById(groups, groups.activeGroupId) !== undefined
  )
}

function validNode(
  node: GroupNode,
  parentAxis: EditorSplit['axis'] | null,
  identities: Set<string>,
  singletons: Set<string>,
  root: boolean,
): boolean {
  if (identities.has(node.id)) return false
  identities.add(node.id)
  if (node.kind === 'group') return validLeaf(node, identities, singletons, root)
  if (node.axis === parentAxis || node.children.length < 2) return false
  if (!node.children.every((child) => Number.isFinite(child.size) && child.size > 0)) return false
  const total = node.children.reduce((sum, child) => sum + child.size, 0)
  if (Math.abs(total - 100) > 1e-6) return false
  return node.children.every((child) =>
    validNode(child.node, node.axis, identities, singletons, false),
  )
}

function validLeaf(
  group: EditorGroup,
  identities: Set<string>,
  singletons: Set<string>,
  root: boolean,
): boolean {
  if (!root && group.tabs.length === 0) return false
  if (group.selectedTabId !== null && !group.tabs.some((tab) => tab.id === group.selectedTabId))
    return false
  const contents = new Set<string>()
  for (const tab of group.tabs) {
    if (!validTab(tab, identities, contents, singletons)) return false
  }
  return true
}

function validTab(
  tab: EditorTabRecord,
  identities: Set<string>,
  contents: Set<string>,
  singletons: Set<string>,
): boolean {
  const key = tabContentKey(tab.content)
  if (identities.has(tab.id) || contents.has(key)) return false
  identities.add(tab.id)
  contents.add(key)
  if (canCopyTabContent(tab.content)) return true
  if (singletons.has(key)) return false
  singletons.add(key)
  return true
}
