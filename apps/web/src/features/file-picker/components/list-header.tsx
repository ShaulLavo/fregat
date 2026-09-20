import { cn } from '@workspace/ui/lib/utils'
import { fileListGridClass } from '@/features/file-picker/utils/rows'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import type { FileListSort, FileListSortKey } from '@/features/file-picker/utils/sort-entries'
import { SortableColumnHeader } from '@/features/file-picker/components/sortable-column-header'

export function ListHeader({
  isLoading,
  isSearching,
  mode,
  onSort,
  sort,
}: {
  isLoading: boolean
  isSearching: boolean
  mode: FilePickerMode
  onSort: (key: FileListSortKey) => void
  sort: FileListSort | null
}) {
  return (
    <div
      aria-label='File list sorting'
      className={cn(
        'h-(--bar-height) border-border text-muted-foreground grid items-center gap-(--density-control-gap) border-b px-(--density-control-padding-x) text-2xs font-medium tracking-normal uppercase',
        fileListGridClass(mode),
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
      {mode === 'file' ? (
        <SortableColumnHeader keyName='kind' label='Kind' onSort={onSort} sort={sort} />
      ) : null}
      <SortableColumnHeader
        className='max-sm:hidden'
        keyName='modified'
        label='Modified'
        onSort={onSort}
        sort={sort}
      />
      <SortableColumnHeader
        align='end'
        className='max-sm:hidden'
        keyName='size'
        label='Size'
        onSort={onSort}
        sort={sort}
      />
    </div>
  )
}
