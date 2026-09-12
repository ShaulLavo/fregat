import type { WorkspaceSearchMatch } from '@workspace/contracts'
import { updateStableHashCode } from '@workspace/client-core/address/path-hash'

import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'

export type SearchResultId = string

export type SearchResultItem =
  | {
      group: WorkspaceSearchFileGroup
      id: SearchResultId
      level: 1
      pending: boolean
      type: 'group'
    }
  | {
      group: WorkspaceSearchFileGroup
      id: SearchResultId
      level: 1
      match: WorkspaceSearchMatch
      pending: boolean
      type: 'name'
    }
  | {
      groupId: SearchResultId
      groupPath: string
      id: SearchResultId
      level: 2
      match: WorkspaceSearchMatch
      matchIndex: number
      pending: boolean
      type: 'match'
    }

export type SearchResultItemOptions = {
  pendingResultIds?: readonly SearchResultId[] | ReadonlySet<SearchResultId>
}

const STABLE_HASH_CACHE_LIMIT = 4096
const STABLE_HASH_OFFSET = 0x811c9dc5
const stableHashCache = new Map<string, string>()
const searchMatchLocationHashCache = new WeakMap<WorkspaceSearchMatch, string>()

export function searchResultItems(
  groups: readonly WorkspaceSearchFileGroup[],
  options: SearchResultItemOptions = {},
) {
  const items: SearchResultItem[] = []
  const pendingIds = pendingResultIdSet(options.pendingResultIds)

  for (const group of groups) {
    appendGroupItems(items, group, pendingIds)
  }

  return items
}

function appendGroupItems(
  items: SearchResultItem[],
  group: WorkspaceSearchFileGroup,
  pendingIds: ReadonlySet<SearchResultId> | null,
) {
  const groupId = searchResultGroupId(group.path)
  const contentMatches = contentSearchMatches(group)
  if (contentMatches.length === 0) {
    const match = group.matches[0]
    if (match) {
      const id = searchResultNameId(group.path, match)
      items.push({
        group,
        id,
        level: 1,
        match,
        pending: pendingResultIdHas(pendingIds, id),
        type: 'name',
      })
    }
    return
  }

  const matchItems = searchContentResultItems(group, groupId, contentMatches, pendingIds)
  items.push({
    group: contentGroup(group, contentMatches),
    id: groupId,
    level: 1,
    pending: matchItems.length > 0 && matchItems.every((item) => item.pending),
    type: 'group',
  })
  if (group.collapsed) return

  items.push(...matchItems)
}

function searchContentResultItems(
  group: WorkspaceSearchFileGroup,
  groupId: SearchResultId,
  contentMatches: readonly WorkspaceSearchMatch[],
  pendingIds: ReadonlySet<SearchResultId> | null,
) {
  const items: Extract<SearchResultItem, { type: 'match' }>[] = []
  const duplicateCounts = new Map<string, number>()
  for (let matchIndex = 0; matchIndex < contentMatches.length; matchIndex += 1) {
    const match = contentMatches[matchIndex]
    if (!match) continue

    const locationHash = searchMatchLocationHash(match)
    const duplicateIndex = nextDuplicateIndex(duplicateCounts, locationHash)
    const id = searchResultMatchIdForIdentityHash(group.path, locationHash, duplicateIndex)
    items.push({
      groupId,
      groupPath: group.path,
      id,
      level: 2,
      match,
      matchIndex,
      pending: pendingResultIdHas(pendingIds, id),
      type: 'match',
    })
  }

  return items
}

function contentSearchMatches(group: WorkspaceSearchFileGroup) {
  if (group.count === group.matches.length) return group.matches

  return group.matches.filter((match) => match.kind === 'content')
}

export function expandedSearchResultItems(
  groups: readonly WorkspaceSearchFileGroup[],
  options: SearchResultItemOptions = {},
) {
  return searchResultItems(groups.map(expandedGroup), options)
}

export function searchResultItemById(
  items: readonly SearchResultItem[],
  id: SearchResultId | null,
) {
  if (!id) return null

  return items.find((item) => item.id === id) ?? null
}

function firstSelectableSearchResultId(groups: readonly WorkspaceSearchFileGroup[]) {
  let firstVisibleId: SearchResultId | null = null

  for (const group of groups) {
    firstVisibleId ??= firstVisibleGroupResultId(group)

    const selectableId = firstSelectableGroupResultId(group)
    if (selectableId) return selectableId
  }

  return firstVisibleId
}

export function visibleSearchResultId(
  groups: readonly WorkspaceSearchFileGroup[],
  id: SearchResultId | null,
) {
  if (!id) return firstSelectableSearchResultId(groups)

  if (searchResultIdIsVisible(groups, id)) return id

  const parentId = hiddenSearchResultParentId(groups, id)
  if (parentId) return parentId

  return firstSelectableSearchResultId(groups)
}

export function searchResultContentItems(items: readonly SearchResultItem[]) {
  return items.filter(isContentSearchResultItem)
}

export function searchResultActiveMatchPosition(
  items: readonly SearchResultItem[],
  activeResultId: SearchResultId | null,
) {
  const matches = searchResultContentItems(items)
  const index = matches.findIndex((item) => item.id === activeResultId)
  if (index < 0) return null

  return {
    index: index + 1,
    total: matches.length,
  }
}

export function searchResultIdByOffset({
  activeResultId,
  items,
  offset,
}: {
  activeResultId: SearchResultId | null
  items: readonly SearchResultItem[]
  offset: number
}) {
  if (items.length === 0) return null

  const activeIndex = searchResultIndex(items, activeResultId)
  const fallback = offset >= 0 ? 0 : items.length - 1
  if (activeIndex < 0) return items[fallback]?.id ?? null

  const startIndex = activeIndex < 0 ? fallback : activeIndex
  const nextIndex = clampIndex(startIndex + offset, items.length)
  return items[nextIndex]?.id ?? null
}

export function firstSearchResultId(items: readonly SearchResultItem[]) {
  return items[0]?.id ?? null
}

export function lastSearchResultId(items: readonly SearchResultItem[]) {
  return items.at(-1)?.id ?? null
}

export function searchResultIdIsName(id: SearchResultId) {
  return id.startsWith(searchResultDomPrefix('name'))
}

export function firstSearchResultChildId(
  items: readonly SearchResultItem[],
  groupId: SearchResultId,
) {
  return items.find((item) => item.type === 'match' && item.groupId === groupId)?.id
}

export function parentSearchResultId(
  items: readonly SearchResultItem[],
  activeResultId: SearchResultId | null,
) {
  const active = searchResultItemById(items, activeResultId)
  if (active?.type !== 'match') return null

  return active.groupId
}

function contentGroup(group: WorkspaceSearchFileGroup, matches: WorkspaceSearchMatch[]) {
  if (matches === group.matches && matches.length === group.count) {
    return group
  }

  return {
    ...group,
    count: matches.length,
    matches,
  }
}

function expandedGroup(group: WorkspaceSearchFileGroup) {
  if (!group.collapsed) return group

  return {
    ...group,
    collapsed: false,
  }
}

function isContentSearchResultItem(
  item: SearchResultItem,
): item is Extract<SearchResultItem, { type: 'match' }> {
  return item.type === 'match'
}

function searchResultIndex(items: readonly SearchResultItem[], id: SearchResultId | null) {
  if (!id) return -1

  return items.findIndex((item) => item.id === id)
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), length - 1)
}

function searchResultGroupId(path: string) {
  return searchResultDomId('group', path)
}

function searchResultNameId(path: string, match: WorkspaceSearchMatch) {
  return searchResultMatchDomId('name', path, searchMatchLocationHash(match), 0)
}

function searchResultMatchId(path: string, match: WorkspaceSearchMatch, duplicateIndex: number) {
  return searchResultMatchIdForIdentityHash(path, searchMatchLocationHash(match), duplicateIndex)
}

function searchResultMatchIdForIdentityHash(
  path: string,
  identityHash: string,
  duplicateIndex: number,
) {
  return searchResultMatchDomId('match', path, identityHash, duplicateIndex)
}

function searchResultDomId(prefix: string, value: string) {
  return `${searchResultDomPrefix(prefix)}${stableHash(value)}`
}

function searchResultDomPrefix(prefix: string) {
  return `search-result-${prefix}-`
}

function searchResultMatchDomId(
  prefix: string,
  path: string,
  identityHash: string,
  duplicateIndex: number,
) {
  const duplicateSuffix = duplicateIndex === 0 ? '' : `-${duplicateIndex}`

  return `${searchResultDomPrefix(prefix)}${stableHash(path)}-${identityHash}${duplicateSuffix}`
}

function searchMatchLocationHash(match: WorkspaceSearchMatch) {
  const cached = searchMatchLocationHashCache.get(match)
  if (cached) return cached

  const locationHash = hashSearchMatchLocation(match)
  searchMatchLocationHashCache.set(match, locationHash)

  return locationHash
}

function hashSearchMatchLocation(match: WorkspaceSearchMatch) {
  let hash = STABLE_HASH_OFFSET
  hash = updateStableHash(hash, match.kind)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.source)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.type)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.targetType)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.path)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.line)
  hash = updateStableHashCode(hash, 0)
  hash = updateStableHash(hash, match.column)

  return stableHashResult(hash)
}

function stableHash(value: string) {
  const cached = stableHashCache.get(value)
  if (cached) return cached

  const result = stableHashResult(updateStableHash(STABLE_HASH_OFFSET, value))
  stableHashCache.set(value, result)
  trimStableHashCache()

  return result
}

function updateStableHash(hash: number, value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return hash

  const text = String(value)
  for (let index = 0; index < text.length; index += 1) {
    hash = updateStableHashCode(hash, text.charCodeAt(index))
  }

  return hash
}

function stableHashResult(hash: number) {
  return (hash >>> 0).toString(36)
}

function pendingResultIdSet(pendingResultIds: SearchResultItemOptions['pendingResultIds']) {
  if (!pendingResultIds) return null
  if (pendingResultIds instanceof Set) return pendingResultIds

  return new Set(pendingResultIds)
}

function pendingResultIdHas(
  pendingResultIds: ReadonlySet<SearchResultId> | null,
  id: SearchResultId,
) {
  if (!pendingResultIds) return false

  return pendingResultIds.has(id)
}

function trimStableHashCache() {
  if (stableHashCache.size <= STABLE_HASH_CACHE_LIMIT) return

  const firstKey = stableHashCache.keys().next().value
  if (firstKey === undefined) return

  stableHashCache.delete(firstKey)
}

function firstVisibleGroupResultId(group: WorkspaceSearchFileGroup): SearchResultId | null {
  if (firstContentMatch(group)) return searchResultGroupId(group.path)

  const match = group.matches[0]
  if (!match) return null

  return searchResultNameId(group.path, match)
}

function firstSelectableGroupResultId(group: WorkspaceSearchFileGroup): SearchResultId | null {
  const match = firstContentMatch(group)
  if (!match) return firstNameResultId(group)
  if (group.collapsed) return null

  return searchResultMatchId(group.path, match, 0)
}

function firstNameResultId(group: WorkspaceSearchFileGroup): SearchResultId | null {
  if (firstContentMatch(group)) return null

  const match = group.matches[0]
  if (!match) return null

  return searchResultNameId(group.path, match)
}

function firstContentMatch(group: WorkspaceSearchFileGroup) {
  return group.matches.find((match) => match.kind === 'content') ?? null
}

function searchResultIdIsVisible(groups: readonly WorkspaceSearchFileGroup[], id: SearchResultId) {
  for (const group of groups) {
    if (groupResultIdIsVisible(group, id)) return true
  }

  return false
}

function groupResultIdIsVisible(group: WorkspaceSearchFileGroup, id: SearchResultId) {
  const firstContent = firstContentMatch(group)
  if (!firstContent) return nameResultIdIsVisible(group, id)
  if (searchResultGroupId(group.path) === id) return true
  if (group.collapsed) return false

  return contentResultIdIsPresent(group, id)
}

function nameResultIdIsVisible(group: WorkspaceSearchFileGroup, id: SearchResultId) {
  const match = group.matches[0]
  if (!match) return false

  return searchResultNameId(group.path, match) === id
}

function hiddenSearchResultParentId(
  groups: readonly WorkspaceSearchFileGroup[],
  id: SearchResultId,
) {
  for (const group of groups) {
    if (!contentResultIdIsPresent(group, id)) continue

    return searchResultGroupId(group.path)
  }

  return null
}

function contentResultIdIsPresent(group: WorkspaceSearchFileGroup, id: SearchResultId) {
  const duplicateCounts = new Map<string, number>()

  for (const match of group.matches) {
    if (match.kind !== 'content') continue

    const locationHash = searchMatchLocationHash(match)
    const duplicateIndex = nextDuplicateIndex(duplicateCounts, locationHash)
    const matchId = searchResultMatchIdForIdentityHash(group.path, locationHash, duplicateIndex)
    if (matchId === id) return true
  }

  return false
}

function nextDuplicateIndex(duplicateCounts: Map<string, number>, identity: string) {
  const duplicateIndex = duplicateCounts.get(identity) ?? 0
  duplicateCounts.set(identity, duplicateIndex + 1)

  return duplicateIndex
}
