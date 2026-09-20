import { ListRow, type ListRowProps } from '@workspace/ui/patterns/list-row'
import { FileTextIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchMatch } from '@workspace/contracts'
import { memo } from 'react'

import { searchMatchDisplay } from '@/features/search/utils/match-display'
import { HighlightedPreview } from '@/features/search/components/highlight'
import { cn } from '@workspace/ui/lib/utils'

export const SearchNameMatchRow = memo(
  ({
    active,
    rowProps,
    className,
    compact,
    match,
    previewMaxLength,
    query,
    onOpenMatch,
  }: {
    rowProps?: Omit<ListRowProps, 'ref' | 'as'>
    active?: boolean
    className?: string
    compact?: boolean
    match: WorkspaceSearchMatch
    previewMaxLength?: number
    query: string
    onOpenMatch: (match: WorkspaceSearchMatch) => void
  }) => {
    const display = searchMatchDisplay(match, query, {
      maxLength: previewMaxLength,
    })

    return (
      <ListRow
        {...rowProps}
        as='button'
        role='treeitem'
        selected={active}
        title={match.path}
        className={cn(
          'relative grid w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden text-left outline-none',
          compact && 'grid-cols-[14px_minmax(0,1fr)_auto] gap-1',
          className,
        )}
        tabIndex={-1}
        type='button'
        onClick={(event) => {
          rowProps?.onClick?.(event)
          onOpenMatch(match)
        }}
      >
        <FileTextIcon
          className={cn(
            'size-(--icon-size-sm) text-muted-foreground',
            compact && 'size-(--icon-size-sm)',
          )}
        />
        <span className='block min-w-0 truncate text-xs'>
          <HighlightedPreview preview={display.text} query={query} range={display.range} />
        </span>
        <span
          className={cn(
            'rounded-md bg-muted/50 px-1.5 text-3xs leading-4 text-muted-foreground',
            compact && 'px-1',
          )}
        >
          name
        </span>
      </ListRow>
    )
  },
)
