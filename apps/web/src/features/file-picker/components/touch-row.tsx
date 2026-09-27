import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'
import type { MouseEvent } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { fileListAvailabilityLabel } from '@/features/file-picker/utils/availability'
import {
  displayPath,
  formatSizeLabel,
  isPickableEntry,
  type FilePickerMode,
} from '@/features/file-picker/utils/model'
import { ENTRY_NAME_TEXT, formatFileListModified } from '@/features/file-picker/utils/rows'

/** A finger-sized row: one tap opens a folder or selects a file, and folders say they drill in. */
export function TouchRow({
  accept,
  entry,
  isBusy,
  mode,
  onOpen,
  position,
  rowProps,
  selected,
  setSize,
  showPath,
}: {
  accept?: readonly string[]
  entry: FsEntry
  isBusy: boolean
  mode: FilePickerMode
  onOpen: (entry: FsEntry) => void
  position: number
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
  setSize: number
  showPath: boolean
}) {
  const directory = isDirectoryEntry(entry)
  const pickable = isPickableEntry(entry, mode, accept)
  const availabilityLabel = fileListAvailabilityLabel(entry, mode, pickable)
  const modified = formatFileListModified(entry.mtimeMs)
  const facts = directory ? modified : `${formatSizeLabel(entry)} · ${modified}`

  function handleClick(event: MouseEvent<HTMLElement>) {
    rowProps.onClick(event)
    if (directory && !isBusy) onOpen(entry)
  }

  return (
    <ListRow
      {...rowProps}
      aria-posinset={position}
      aria-setsize={setSize}
      className={cn(
        'flex w-full cursor-default items-center gap-(--density-control-gap) py-(--density-row-padding-y) text-left',
        !pickable && !directory && 'text-muted-foreground',
      )}
      disabled={isBusy}
      onClick={handleClick}
      role='option'
      selected={selected}
      title={entry.path}
    >
      <EntryIcon className='size-(--icon-size) shrink-0' entry={entry} open={selected} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className={cn(ENTRY_NAME_TEXT, 'truncate text-sm')}>{entry.name}</span>
        <span className='text-muted-foreground text-2xs truncate font-mono tabular-nums'>
          {showPath ? displayPath(entry.path) : facts}
        </span>
      </div>
      {directory ? (
        <CaretRightIcon
          aria-hidden='true'
          className='text-muted-foreground size-(--icon-size-sm) shrink-0'
        />
      ) : null}
      {!directory && selected ? (
        <CheckIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      ) : null}
      {availabilityLabel ? <span className='sr-only'>{availabilityLabel}</span> : null}
    </ListRow>
  )
}
