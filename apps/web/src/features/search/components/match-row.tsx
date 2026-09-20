import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ListRow, type ListRowProps } from '@workspace/ui/patterns/list-row'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { memo } from 'react'

import { searchMatchDisplay } from '@/features/search/utils/match-display'
import { HighlightedPreview } from '@/features/search/components/highlight'
import { workspaceSearchReplacementPreview } from '@/features/search/utils/replace'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import {
  searchMatchLocation,
  searchMatchOpenLabel,
  matchPreviewMaxLength,
} from '@/features/search/utils/row-labels'

export const SearchMatchRow = memo(
  ({
    active,
    rowProps,
    className,
    canReplace,
    compact,
    match,
    previewMaxLength,
    replaceQuery,
    replaceText,
    replaceVisible,
    query,
    onOpenMatch,
    onReplaceMatch,
  }: {
    rowProps?: Omit<ListRowProps, 'ref' | 'as'>
    active?: boolean
    className?: string
    canReplace?: boolean
    compact?: boolean
    match: WorkspaceSearchMatch
    previewMaxLength?: number
    replaceQuery: WorkspaceSearchQuery | null
    replaceText: string
    replaceVisible?: boolean
    query: string
    onOpenMatch: (match: WorkspaceSearchMatch) => void
    onReplaceMatch?: (match: WorkspaceSearchMatch) => void
  }) => {
    const location = searchMatchLocation(match)
    const display = searchMatchDisplay(match, query, {
      maxLength: matchPreviewMaxLength(match, previewMaxLength),
    })
    const replacementPreview =
      replaceVisible && replaceQuery
        ? workspaceSearchReplacementPreview({
            match,
            query: replaceQuery,
            replaceText,
          })
        : null

    return (
      <ListRow
        {...rowProps}
        role='treeitem'
        selected={active}
        title={`${match.path}:${match.line ?? 1}:${match.column ?? 1} · ${display.text}`}
        className={cn(
          'group relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden text-left text-xs',
          compact && 'gap-1',
          className,
        )}
      >
        <div
          className={cn(
            'grid w-full min-w-0 grid-cols-[42px_minmax(0,1fr)] gap-2 text-left',
            compact && 'grid-cols-[34px_minmax(0,1fr)] gap-1.5',
          )}
        >
          <span className='text-muted-foreground text-2xs text-right tabular-nums'>{location}</span>
          <span
            className={cn('flex min-w-0 items-center gap-2 overflow-hidden', compact && 'gap-1.5')}
          >
            <span
              className={cn(
                'block min-w-0 flex-1 truncate font-mono text-2xs leading-5',
                compact && 'leading-4',
              )}
            >
              <HighlightedPreview
                active={active}
                preview={display.text}
                query={query}
                range={display.range}
                replacementText={replacementPreview?.text}
              />
            </span>
            {match.source === 'open-buffer' ? (
              <span className='bg-muted/50 text-muted-foreground text-3xs shrink-0 rounded-md px-1 leading-4'>
                unsaved
              </span>
            ) : null}
          </span>
        </div>
        <div className='flex h-full shrink-0 items-center gap-0.5'>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={searchMatchOpenLabel(match)}
                  className={cn(
                    'pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
                    compact && 'size-5',
                    active && 'pointer-events-auto opacity-100',
                  )}
                  size='icon-xs'
                  tabIndex={-1}
                  type='button'
                  variant='ghost'
                  onClick={() => onOpenMatch(match)}
                >
                  <ArrowSquareOutIcon className='size-(--icon-size-sm)' />
                </Button>
              }
            />
            <TooltipContent>{searchMatchOpenLabel(match)}</TooltipContent>
          </Tooltip>
          {replaceVisible ? (
            <Button
              className={cn('px-1.5 text-3xs', compact && 'h-5 px-1')}
              disabled={!canReplace}
              data-row-action='replace'
              aria-keyshortcuts='F2'
              size='xs'
              tabIndex={-1}
              title='Replace this match (F2)'
              type='button'
              variant='ghost'
              onClick={() => onReplaceMatch?.(match)}
            >
              Replace
            </Button>
          ) : null}
        </div>
      </ListRow>
    )
  },
)
