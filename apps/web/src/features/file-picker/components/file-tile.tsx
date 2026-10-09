import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import type { FsEntry } from '@/lib/file-system-types'
import { EntryPreviewTile } from '@/features/file-picker/components/entry-preview-tile'

/** One folder in the icons grid. */
export function FileTile({
  entry,
  isBusy,
  rowProps,
  selected,
  onDoubleClick,
}: {
  entry: FsEntry
  isBusy: boolean
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
  onDoubleClick: (entry: FsEntry) => void
}) {
  return (
    <ListRow
      {...rowProps}
      className='flex h-auto w-(--picker-tile-width) cursor-default flex-col items-center gap-1 rounded-md p-2'
      disabled={isBusy}
      role='option'
      selected={selected}
      title={entry.path}
      onDoubleClick={() => {
        if (!isBusy) onDoubleClick(entry)
      }}
    >
      <span className='flex h-20 w-full items-center justify-center'>
        <EntryPreviewTile entry={entry} />
      </span>
      <span className='w-full truncate text-center text-xs'>{entry.name}</span>
    </ListRow>
  )
}
