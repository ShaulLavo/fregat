import { CaretRightIcon } from '@phosphor-icons/react'
import { useForesight } from '@foresightjs/react'
import { cn } from '@workspace/ui/lib/utils'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { ENTRY_NAME_TEXT } from '@/features/file-picker/utils/rows'
import { DIRECTORY_QUERY_STALE_MS } from '@/features/file-picker/utils/directory-query'
import { isPickableEntry, type FilePickerMode } from '@/features/file-picker/utils/model'

/** A name and its icon; a folder carries the caret that says a column opens to its right. */
export function ColumnRow({
  accept,
  entry,
  isBusy,
  mode,
  onDirectoryIntent,
  onDoubleClick,
  rowProps,
  selected,
}: {
  accept?: readonly string[]
  entry: FsEntry
  isBusy: boolean
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onDoubleClick: (entry: FsEntry) => void
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
}) {
  const directory = isDirectoryEntry(entry)
  const { elementRef } = useForesight<HTMLDivElement>({
    callback: () => {
      if (directory && !isBusy) onDirectoryIntent(entry.path)
    },
    enabled: directory && !isBusy,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: { path: entry.path },
    name: `file-picker-column:${entry.path}`,
    reactivateAfter: DIRECTORY_QUERY_STALE_MS,
  })

  return (
    <ListRow
      {...rowProps}
      className={cn(
        'flex w-full cursor-default items-center text-left',
        !isPickableEntry(entry, mode, accept) && !directory && 'text-muted-foreground',
      )}
      disabled={isBusy}
      ref={directory ? elementRef : undefined}
      role='option'
      selected={selected}
      title={entry.path}
      onDoubleClick={() => {
        if (!isBusy) onDoubleClick(entry)
      }}
    >
      <EntryIcon className='size-(--icon-size) shrink-0' entry={entry} open={selected} />
      <span className={cn('min-w-0 flex-1 truncate', ENTRY_NAME_TEXT)}>{entry.name}</span>
      {directory ? (
        <CaretRightIcon
          aria-hidden='true'
          className='text-muted-foreground size-(--icon-size-sm) shrink-0'
        />
      ) : null}
    </ListRow>
  )
}
