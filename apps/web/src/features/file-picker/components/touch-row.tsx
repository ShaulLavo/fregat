import { CaretRightIcon } from '@phosphor-icons/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'
import type { MouseEvent } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { ChoiceMark } from '@/features/file-picker/components/choice-mark'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { displayPath } from '@/features/file-picker/utils/model'
import { ENTRY_NAME_TEXT, formatFileListModified } from '@/features/file-picker/utils/rows'

/**
 * A finger-sized row: one tap opens the folder, and its caret says it drills in. A file that can
 * be chosen shows its choice mark instead, and the tap chooses it.
 */
export function TouchRow({
  chosen = null,
  entry,
  isBusy,
  onOpen,
  position,
  rowProps,
  selected,
  setSize,
  showPath,
}: {
  /** Null when the row is not a choice: a folder, or a picker that chooses folders. */
  chosen?: boolean | null
  entry: FsEntry
  isBusy: boolean
  onOpen: (entry: FsEntry) => void
  position: number
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
  setSize: number
  showPath: boolean
}) {
  const modified = formatFileListModified(entry.mtimeMs)

  function handleClick(event: MouseEvent<HTMLElement>) {
    rowProps.onClick(event)
    if (!isBusy) onOpen(entry)
  }

  return (
    <ListRow
      {...rowProps}
      aria-checked={chosen ?? undefined}
      aria-posinset={position}
      aria-setsize={setSize}
      className='flex w-full cursor-default items-center gap-(--density-control-gap) py-(--density-row-padding-y) text-left'
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
          {showPath ? displayPath(entry.path) : modified}
        </span>
      </div>
      {chosen === null ? (
        <CaretRightIcon
          aria-hidden='true'
          className='text-muted-foreground size-(--icon-size-sm) shrink-0'
        />
      ) : (
        <ChoiceMark chosen={chosen} />
      )}
    </ListRow>
  )
}
