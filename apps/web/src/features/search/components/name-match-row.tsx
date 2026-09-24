import { ListRow, type ListRowProps } from '@workspace/ui/patterns/list-row'
import { memo } from 'react'

import { FileLabel } from '@/components/file-label'
import { HighlightedPreview } from '@/features/search/components/highlight'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { basename, parentPath } from '@/lib/path-formatters'
import { cn } from '@workspace/ui/lib/utils'

/** A filename result: the basename always shows, with the query marked wherever it matched. */
export const SearchNameMatchRow = memo(
  ({
    active,
    rowProps,
    className,
    compact,
    group,
    query,
    onOpen,
  }: {
    rowProps?: Omit<ListRowProps, 'ref' | 'as'>
    active?: boolean
    className?: string
    compact?: boolean
    group: WorkspaceSearchFileGroup
    query: string
    onOpen: () => void
  }) => (
    <ListRow
      {...rowProps}
      as='button'
      role='treeitem'
      selected={active}
      title={group.path}
      className={cn(
        'relative grid w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden text-left outline-none',
        compact && 'grid-cols-[14px_minmax(0,1fr)_auto] gap-1',
        className,
      )}
      tabIndex={-1}
      type='button'
      onClick={(event) => {
        rowProps?.onClick?.(event)
        onOpen()
      }}
    >
      <FileLabel
        className='text-xs'
        directory={
          <HighlightedPreview inline preview={parentPath(group.pathLabel)} query={query} />
        }
        name={<HighlightedPreview inline preview={basename(group.pathLabel)} query={query} />}
        path={group.pathLabel}
      />
      <span
        className={cn(
          'rounded-md bg-muted/50 px-1.5 text-3xs leading-4 text-muted-foreground',
          compact && 'px-1',
        )}
      >
        name
      </span>
    </ListRow>
  ),
)
