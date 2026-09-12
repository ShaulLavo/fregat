import { ArrowSquareOutIcon, FileTextIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { memo } from 'react'

import { searchMatchDisplay } from '@/features/search/utils/match-display'
import { HighlightedPreview } from '@/features/search/components/highlight'
import { workspaceSearchReplacementPreview } from '@/features/search/utils/replace'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export const SearchMatchRow = memo(
  ({
    active,
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
      <div
        className={cn(
          'group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left text-xs',
          compact && 'h-6 gap-1 px-1.5 py-0',
          active && 'bg-row-selected',
          !active && 'hover:bg-row-hover',
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
          <Button
            aria-label={searchMatchOpenLabel(match)}
            className={cn(
              'pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
              compact && 'size-5',
              active && 'pointer-events-auto opacity-100',
            )}
            size='icon-xs'
            title={searchMatchOpenLabel(match)}
            type='button'
            variant='ghost'
            onClick={() => onOpenMatch(match)}
          >
            <ArrowSquareOutIcon className='size-3.5' />
          </Button>
          {replaceVisible ? (
            <Button
              className={cn('h-6 px-1.5 text-3xs', compact && 'h-5 px-1')}
              disabled={!canReplace}
              size='xs'
              title='Replace this match'
              type='button'
              variant='ghost'
              onClick={() => onReplaceMatch?.(match)}
            >
              Replace
            </Button>
          ) : null}
        </div>
      </div>
    )
  },
)

export const SearchNameMatchRow = memo(
  ({
    active,
    className,
    compact,
    match,
    previewMaxLength,
    query,
    onOpenMatch,
  }: {
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
      // Raw button: the whole list row is the hit target, and Button's control
      // shape (radius, fixed height, hover fill) is exactly what rows must not have.
      <button
        className={cn(
          'focus-ring grid w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left outline-none',
          compact && 'h-6 grid-cols-[14px_minmax(0,1fr)_auto] gap-1 px-1.5 py-0',
          active && 'bg-row-selected',
          !active && 'hover:bg-row-hover active:bg-row-active',
          className,
        )}
        tabIndex={-1}
        type='button'
        onClick={() => onOpenMatch(match)}
      >
        <FileTextIcon className={cn('size-3.5 text-muted-foreground', compact && 'size-3')} />
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
      </button>
    )
  },
)

function searchMatchLocation(match: WorkspaceSearchMatch) {
  if (match.kind === 'name') return 'name'
  if (match.line === undefined) return 'match'

  return String(match.line)
}

function searchMatchOpenLabel(match: WorkspaceSearchMatch) {
  if (typeof match.line !== 'number') return 'Open result'
  if (typeof match.column !== 'number') return `Open result at line ${match.line}`

  return `Open result at line ${match.line}, column ${match.column}`
}

function matchPreviewMaxLength(match: WorkspaceSearchMatch, previewMaxLength: number | undefined) {
  if (match.source !== 'open-buffer') return previewMaxLength
  if (previewMaxLength === undefined) return undefined

  return Math.max(12, previewMaxLength - 8)
}
