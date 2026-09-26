import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { sortFilePickerEntries } from '@/features/file-picker/utils/sort-entries'
import { ENTRY_NAME_TEXT } from '@/features/file-picker/utils/rows'
import { cn } from '@workspace/ui/lib/utils'
import { PREVIEW_CHILDREN } from '@/features/file-picker/utils/preview'
import { filterPickerEntries } from '@/features/file-picker/utils/type-filter'

const BY_NAME = { direction: 'ascending', key: 'name' } as const

/** A folder's first children, from the listing the selection already prefetched. */
export function FolderPreview({
  accept,
  entry,
  mode,
  showHidden,
}: {
  accept?: readonly string[]
  entry: FsEntry
  mode: FilePickerMode
  showHidden: boolean
}) {
  const query = useQuery(directoryQueryOptions({ mode, path: entry.path, query: '', showHidden }))
  if (query.isPending)
    return (
      <LoadingState className='flex w-full flex-col' label={`Loading ${entry.name}`}>
        {Array.from({ length: 3 }, (_, index) => (
          <div className='flex h-(--density-row-height) items-center' key={index}>
            <div className='skeleton-sweep h-3 w-28 rounded-md' />
          </div>
        ))}
      </LoadingState>
    )
  if (query.isError)
    return <EmptyState align='start' title='Could not read this folder.' tone='error' />
  const shown = filterPickerEntries(query.data.entries, mode, accept)
  if (query.data.entries.length === 0) return <EmptyState align='start' title='Empty folder' />
  if (shown.length === 0) return <EmptyState align='start' title='No matching files' />
  const children = sortFilePickerEntries(shown, BY_NAME).slice(0, PREVIEW_CHILDREN)

  return (
    <ul
      aria-label={`Inside ${entry.name}`}
      className='flex w-full min-w-0 flex-col text-left text-xs'
    >
      {children.map((child) => (
        <li
          className='flex h-(--density-row-height) min-w-0 items-center gap-(--density-control-gap)'
          key={child.path}
          title={child.path}
        >
          <EntryIcon className='size-(--icon-size)' entry={child} />
          <span className={cn('truncate', ENTRY_NAME_TEXT)}>{child.name}</span>
        </li>
      ))}
    </ul>
  )
}
