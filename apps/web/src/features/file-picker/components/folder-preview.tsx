import { useQuery } from '@tanstack/react-query'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import type { FilePickerIconMode, FilePickerMode } from '@/features/file-picker/utils/model'
import { sortFilePickerEntries } from '@/features/file-picker/utils/sort-entries'
import { PREVIEW_CHILDREN } from '@/features/file-picker/utils/preview'

const BY_NAME = { direction: 'ascending', key: 'name' } as const

/** A folder's first children, from the listing the selection already prefetched. */
export function FolderPreview({
  entry,
  iconMode,
  mode,
  showHidden,
}: {
  entry: FsEntry
  iconMode: FilePickerIconMode
  mode: FilePickerMode
  showHidden: boolean
}) {
  const query = useQuery(directoryQueryOptions({ mode, path: entry.path, query: '', showHidden }))
  const children = sortFilePickerEntries(query.data?.entries ?? [], BY_NAME).slice(
    0,
    PREVIEW_CHILDREN,
  )

  return (
    <ul
      aria-label={`Inside ${entry.name}`}
      className='flex w-full min-w-0 flex-col text-left text-xs'
    >
      {children.map((child) => (
        <li
          className='flex h-(--density-row-height) min-w-0 items-center gap-2'
          key={child.path}
          title={child.path}
        >
          <EntryIcon
            className='size-(--icon-size-sm)'
            entry={child}
            iconMode={iconMode}
            selected={false}
          />
          <span className='truncate'>{child.name}</span>
        </li>
      ))}
    </ul>
  )
}
