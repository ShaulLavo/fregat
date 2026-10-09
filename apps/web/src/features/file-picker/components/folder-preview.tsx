import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { folderEntries } from '@/features/file-picker/utils/model'
import { sortFilePickerEntries } from '@/features/file-picker/utils/sort-entries'
import { ENTRY_NAME_TEXT } from '@/features/file-picker/utils/rows'
import { cn } from '@workspace/ui/lib/utils'

const BY_NAME = { direction: 'ascending', key: 'name' } as const
/** A folder previews this many of its children, from the listing already cached. */
const PREVIEW_CHILDREN = 100

/** A folder's first children, from the listing the selection already prefetched. */
export function FolderPreview({ entry, showHidden }: { entry: FsEntry; showHidden: boolean }) {
  const query = useQuery(directoryQueryOptions({ path: entry.path, query: '', showHidden }))
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
  const shown = folderEntries(query.data.entries)
  if (query.data.entries.length === 0) return <EmptyState align='start' title='Empty folder' />
  if (shown.length === 0) return <EmptyState align='start' title='No subfolders' />
  const children = sortFilePickerEntries(shown, BY_NAME).slice(0, PREVIEW_CHILDREN)

  return (
    <ul
      aria-label={`Inside ${entry.name}`}
      className='flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain text-left text-xs'
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
