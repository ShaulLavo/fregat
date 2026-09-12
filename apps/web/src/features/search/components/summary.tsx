import type { ReactNode } from 'react'
import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretDownIcon,
  CaretUpIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { WorkspaceSearchWarningEvent } from '@workspace/contracts'

import {
  searchGroupsForSnapshot,
  type SearchBufferSnapshot,
  useSearchBufferState,
} from '@/features/search/state/buffer-state'
import {
  expandedSearchResultItems,
  searchResultActiveMatchPosition,
  searchResultContentItems,
} from '@/features/search/utils/result-items'
import { SearchNumber } from '@/features/search/components/number'
import { Button } from '@workspace/ui/components/button'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'

export function SearchSummary({
  buttonClassName,
  className,
  query,
  snapshot,
}: {
  buttonClassName?: string
  className?: string
  query: string
  snapshot: SearchBufferSnapshot | null
}) {
  const collapseAllGroups = useSearchBufferState((state) => state.collapseAllGroups)
  const expandAllGroups = useSearchBufferState((state) => state.expandAllGroups)
  const selectNextMatch = useSearchBufferState((state) => state.selectNextMatch)
  const selectPreviousMatch = useSearchBufferState((state) => state.selectPreviousMatch)
  const summary = searchSummaryModel(query, snapshot)

  return (
    <div
      className={cn(
        'mt-2 flex min-h-5 items-center gap-2 px-1 text-2xs text-muted-foreground',
        className,
      )}
    >
      <SearchSummaryText title={summary.title}>{summary.content}</SearchSummaryText>
      {summary.showControls ? (
        <div className='ml-auto flex shrink-0 items-center gap-0.5'>
          <SearchSummaryButton
            className={buttonClassName}
            disabled={!summary.canExpand}
            label='Expand all search results'
            onClick={expandAllGroups}
          >
            <ArrowsOutLineVerticalIcon className='size-3.5' />
          </SearchSummaryButton>
          <SearchSummaryButton
            className={buttonClassName}
            disabled={!summary.canCollapse}
            label='Collapse all search results'
            onClick={collapseAllGroups}
          >
            <ArrowsInLineVerticalIcon className='size-3.5' />
          </SearchSummaryButton>
          <SearchSummaryButton
            className={buttonClassName}
            disabled={!summary.canNavigate}
            label='Previous match'
            onClick={selectPreviousMatch}
          >
            <CaretUpIcon className='size-3.5' />
          </SearchSummaryButton>
          <SearchSummaryButton
            className={buttonClassName}
            disabled={!summary.canNavigate}
            label='Next match'
            onClick={selectNextMatch}
          >
            <CaretDownIcon className='size-3.5' />
          </SearchSummaryButton>
        </div>
      ) : null}
    </div>
  )
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

function SearchSummaryText({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className='min-w-0 flex-1 truncate' title={title}>
      {children}
    </div>
  )
}

function SearchSummaryButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      className={cn('size-5 text-muted-foreground hover:text-foreground', className)}
      disabled={disabled}
      size='icon-xs'
      title={label}
      type='button'
      variant='ghost'
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function emptySummary(text: string, options: { pending?: boolean } = {}) {
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
) {
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
