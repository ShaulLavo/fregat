import { FileTypeIcon } from '@/components/file-type-icon'
import { CaretRightIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { iconForEntry } from '@/lib/file-icons'
import { Button } from '@workspace/ui/components/button'
import { ListRow, type ListRowProps } from '@workspace/ui/patterns/list-row'
import { cn } from '@workspace/ui/lib/utils'

export function SearchFileGroupHeader({
  active,
  rowProps,
  className,
  canReplace,
  group,
  replaceVisible,
  onReplace,
  onToggle,
}: {
  active?: boolean
  rowProps?: Omit<ListRowProps, 'ref' | 'as'>
  className?: string
  canReplace?: boolean
  compact?: boolean
  group: WorkspaceSearchFileGroup
  replaceVisible?: boolean
  onReplace?: (group: WorkspaceSearchFileGroup) => void
  onToggle: (path: string) => void
}) {
  return (
    <ListRow
      {...rowProps}
      role='treeitem'
      selected={active}
      aria-expanded={!group.collapsed}
      className={cn('w-full min-w-0 cursor-pointer text-left', className)}
      title={group.path}
      onClick={(event) => {
        rowProps?.onClick?.(event)
        onToggle(group.path)
      }}
    >
      <CaretRightIcon
        className={cn(
          'size-(--icon-size-sm) shrink-0 text-muted-foreground transition-transform',
          !group.collapsed && 'rotate-90',
        )}
      />
      <FileTypeIcon
        className='size-(--icon-size-sm) shrink-0'
        icon={iconForEntry({ name: group.name, type: 'file' })}
      />
      <span className='min-w-0 flex-1 truncate'>
        <span className='font-medium'>{group.name}</span>
        <span className='text-2xs text-muted-foreground ml-2'>{group.pathLabel}</span>
      </span>
      <span className='text-2xs text-muted-foreground shrink-0 tabular-nums'>
        {group.count.toLocaleString()}
      </span>
      {replaceVisible ? (
        <Button
          className='text-3xs px-1.5'
          disabled={!canReplace}
          data-row-action='replace'
          aria-keyshortcuts='F2'
          size='xs'
          tabIndex={-1}
          title='Replace matches in this file (F2)'
          type='button'
          variant='ghost'
          onClick={(event) => {
            event.stopPropagation()
            onReplace?.(group)
          }}
        >
          Replace
        </Button>
      ) : null}
    </ListRow>
  )
}
