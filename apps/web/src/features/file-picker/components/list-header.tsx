import { cn } from '@workspace/ui/lib/utils'
import { FILE_LIST_GRID } from '@/features/file-picker/utils/rows'
import type { FileListSort, FileListSortKey } from '@/features/file-picker/utils/sort-entries'
import { SortableColumnHeader } from '@/features/file-picker/components/sortable-column-header'

export function ListHeader({
  isLoading,
  isSearching,
  onSort,
  sort,
}: {
  isLoading: boolean
  isSearching: boolean
  onSort: (key: FileListSortKey) => void
  sort: FileListSort | null
}) {
  return (
    <div
      aria-label='File list sorting'
      className={cn(
        'h-(--bar-height) text-muted-foreground grid items-center gap-(--density-control-gap) px-(--density-control-padding-x) section-label',
        FILE_LIST_GRID,
      )}
      role='group'
    >
      <SortableColumnHeader
        isLoading={isLoading}
        keyName='name'
        label={isSearching ? 'Matches' : 'Name'}
        onSort={onSort}
        sort={sort}
      />
      <SortableColumnHeader
        className='max-sm:hidden'
        keyName='modified'
        label='Modified'
        onSort={onSort}
        sort={sort}
      />
    </div>
  )
}
