import type { ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchWarningEvent } from '@workspace/contracts'
import { Shimmer } from '@workspace/ui/components/shimmer'

import { SearchNumber } from '@/features/search/components/number'
import { useSearchBufferValue } from '@/features/search/hooks/use-buffer-value'
import {
  searchGroupsForSnapshot,
  type SearchBufferSnapshot,
} from '@/features/search/state/buffer-state'
import {
  expandedSearchResultItems,
  searchResultActiveMatchPosition,
  searchResultContentItems,
} from '@/features/search/utils/result-items'

export type SearchSummaryModel = {
  readonly canCollapse: boolean
  readonly canExpand: boolean
  readonly canNavigate: boolean
  readonly content: ReactNode
  readonly showControls: boolean
  readonly title: string
}

export function useSearchSummaryModel(rootPath: string): SearchSummaryModel {
  const snapshot = useSearchBufferValue(rootPath, (activeSnapshot) => activeSnapshot, null)

  return searchSummaryModel(snapshot?.query ?? '', snapshot)
}

function searchSummaryModel(query: string, snapshot: SearchBufferSnapshot | null) {
  if (!query) return emptySummary('Find in files')
  if (!snapshot) return emptySummary('Find in files')
  if (snapshot.replaceStatus === 'running') return emptySummary('Replacing', { pending: true })
  if (snapshot.replaceStatus === 'error')
    return emptySummary(snapshot.replaceMessage ?? 'Replace failed')
  if (snapshot.replaceStatus === 'success' && snapshot.replaceMessage)
    return summaryWithControls(snapshot.replaceMessage, snapshot)
  if (snapshot.status === 'error') {
    const message = snapshot.error ?? 'Search failed'
    if (hasSearchResultGroups(snapshot))
      return summaryWithControls(`${message} · Showing previous results`, snapshot)

    return emptySummary(message)
  }
  if (snapshot.status === 'idle') return emptySummary('Searching', { pending: true })
  if (snapshot.status === 'loading' && snapshot.matches.length === 0) {
    return emptySummary('Searching', { pending: true })
  }
  const result = searchResultCount(snapshot)
  if (snapshot.status === 'loading') {
    return summaryWithControls(result.content, snapshot, result.title, {
      pendingText: 'Searching',
    })
  }

  return summaryWithControls(result.content, snapshot, result.title)
}

function emptySummary(text: string, options: { pending?: boolean } = {}): SearchSummaryModel {
  return {
    canCollapse: false,
    canExpand: false,
    canNavigate: false,
    content: options.pending ? <Shimmer>{text}</Shimmer> : text,
    showControls: false,
    title: text,
  }
}

// Warnings ride the summary line rather than a separate banner: they qualify the
// counts sitting right next to them ("40 matches" *that we could reach*), and a
// banner would push results down on every partial run.
function searchWarningNotice(warnings: readonly WorkspaceSearchWarningEvent[]) {
  const warning = warnings[0]
  if (!warning) return { content: null, title: '' }

  const detail = warnings.map((entry) => warningTitleText(entry)).join(' ')

  return {
    content: (
      <span className='text-warning ml-1 inline-flex items-center gap-1 align-bottom'>
        <WarningCircleIcon aria-hidden='true' className='size-3.5 shrink-0' weight='duotone' />
        {warning.message}
      </span>
    ),
    title: ` · ${detail}`,
  }
}

function warningTitleText(warning: WorkspaceSearchWarningEvent) {
  if (!warning.detail) return warning.message

  return `${warning.message} (${warning.detail})`
}

function summaryWithControls(
  content: ReactNode,
  snapshot: SearchBufferSnapshot,
  title = String(content),
  options: { pendingText?: string } = {},
): SearchSummaryModel {
  const groups = searchGroupsForSnapshot(snapshot)
  const expandedItems = expandedSearchResultItems(groups)
  const active = searchResultActiveMatchPosition(expandedItems, snapshot.activeResultId)
  const activeContent = active ? (
    <>
      {' '}
      <span aria-hidden='true'>·</span> <SearchNumber value={active.index} />
      /
      <SearchNumber value={active.total} />
    </>
  ) : null
  const activeTitle = active ? ` · ${active.index}/${active.total}` : ''
  const trailingContent = options.pendingText ? (
    <>
      {' '}
      <span aria-hidden='true'>·</span> <Shimmer>{options.pendingText}</Shimmer>
    </>
  ) : null
  const trailingTitle = options.pendingText ? ` · ${options.pendingText}` : ''
  const warning = searchWarningNotice(snapshot.warnings)

  return {
    canCollapse: groups.some((group) => group.count > 0 && !group.collapsed),
    canExpand: groups.some((group) => group.count > 0 && group.collapsed),
    canNavigate: searchResultContentItems(expandedItems).length > 0,
    content: (
      <>
        {content}
        {activeContent}
        {trailingContent}
        {warning.content}
      </>
    ),
    showControls: groups.some((group) => group.count > 0),
    title: `${title}${activeTitle}${trailingTitle}${warning.title}`,
  }
}

function hasSearchResultGroups(snapshot: SearchBufferSnapshot) {
  return searchGroupsForSnapshot(snapshot).some((group) => group.count > 0)
}

function searchResultCount(snapshot: SearchBufferSnapshot) {
  const groups = searchGroupsForSnapshot(snapshot)
  const fileCount = groups.filter((group) => group.count > 0).length
  const matchTitle = snapshot.totalCount.toLocaleString()
  const fileTitle = fileCount.toLocaleString()
  const matchSummary = snapshot.truncated ? (
    <>
      <SearchNumber value={snapshot.totalCount} /> shown, limit reached
    </>
  ) : (
    <>
      <SearchNumber value={snapshot.totalCount} /> {matchNoun(snapshot.totalCount)}
    </>
  )
  const titleMatches = snapshot.truncated
    ? `${matchTitle} shown, limit reached`
    : `${matchTitle} ${matchNoun(snapshot.totalCount)}`

  return {
    content: (
      <>
        {matchSummary} in <SearchNumber value={fileCount} /> {fileNoun(fileCount)}
      </>
    ),
    title: `${titleMatches} in ${fileTitle} ${fileNoun(fileCount)}`,
  }
}

function matchNoun(count: number) {
  return count === 1 ? 'match' : 'matches'
}

function fileNoun(count: number) {
  return count === 1 ? 'file' : 'files'
}
