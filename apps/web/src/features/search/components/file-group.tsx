import { CaretRightIcon } from '@phosphor-icons/react'
import { memo } from 'react'
import type { CSSProperties } from 'react'

import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { SearchNumber } from '@/features/search/components/number'
import { colorForFileIcon, iconForEntry, type ResolvedFileIcon } from '@/lib/file-icons'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export const SearchFileGroupHeader = memo(
  ({
    active,
    className,
    canReplace,
    compact,
    group,
    replaceVisible,
    onReplace,
    onToggle,
  }: {
    active?: boolean
    className?: string
    canReplace?: boolean
    compact?: boolean
    group: WorkspaceSearchFileGroup
    replaceVisible?: boolean
    onReplace?: (group: WorkspaceSearchFileGroup) => void
    onToggle: (path: string) => void
  }) => {
    const icon = iconForEntry({ name: group.name, type: 'file' })

    return (
      <div
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 px-2 py-1.5 text-left',
          compact && 'h-6 gap-1 overflow-hidden px-1.5 py-0',
          active && 'bg-row-selected',
          !active && 'hover:bg-row-hover active:bg-row-active',
          className,
        )}
      >
        {/* Raw button: it fills the row's grid cell, and Button's control shape
            (radius, fixed height, hover fill) is what a row must not have. */}
        <button
          className={cn(
            'focus-ring grid min-w-0 grid-cols-[16px_16px_minmax(0,1fr)] items-center gap-1.5 text-left outline-none hover:text-foreground',
            compact && 'h-full grid-cols-[14px_14px_minmax(0,1fr)] gap-1 overflow-hidden',
          )}
          tabIndex={-1}
          type='button'
          onClick={() => onToggle(group.path)}
        >
          <CaretRightIcon
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              compact && 'size-3',
              !group.collapsed && 'rotate-90',
            )}
          />
          <span
            aria-hidden='true'
            className={cn('size-4', compact && 'size-3.5')}
            style={fileIconStyle(icon)}
          />
          <SearchFileGroupTitle compact={compact} group={group} />
        </button>
        <span
          className={cn(
            'rounded-md bg-muted/50 px-1.5 text-3xs leading-4 text-muted-foreground',
            compact && 'h-4 px-1 leading-4',
          )}
        >
          <SearchNumber fontSize='10px' value={group.count} />
        </span>
        {replaceVisible ? (
          <Button
            className='text-3xs px-1.5'
            disabled={!canReplace}
            size='xs'
            title='Replace matches in this file'
            type='button'
            variant='ghost'
            onClick={() => onReplace?.(group)}
          >
            Replace
          </Button>
        ) : null}
      </div>
    )
  },
)

function SearchFileGroupTitle({
  compact,
  group,
}: {
  compact: boolean | undefined
  group: WorkspaceSearchFileGroup
}) {
  if (compact) {
    return (
      <span className='flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap'>
        <span className='max-w-[55%] min-w-0 shrink-0 truncate text-xs leading-4 font-medium'>
          {group.name}
        </span>
        <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate leading-4'>
          {group.pathLabel}
        </span>
      </span>
    )
  }

  return (
    <span className='min-w-0'>
      <span className='block truncate text-xs font-medium'>{group.name}</span>
      <span className='text-muted-foreground text-2xs block truncate'>{group.pathLabel}</span>
    </span>
  )
}

function fileIconStyle(icon: ResolvedFileIcon): CSSProperties {
  const mask = `url(${icon.src}) center / contain no-repeat`

  return {
    backgroundColor: colorForFileIcon(icon),
    mask,
    WebkitMask: mask,
  }
}
