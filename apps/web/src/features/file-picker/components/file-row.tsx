import { useForesight } from '@foresightjs/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import {
  displayPath,
  isPickableEntry,
  kindLabel,
  type FilePickerMode,
  type FilePickerIconMode,
} from '@/features/file-picker/utils/model'
import {
  fileListGridClass,
  formatFileListModified,
  fileListSizeLabel,
} from '@/features/file-picker/utils/rows'
import { fileListAvailabilityLabel } from '@/features/file-picker/utils/availability'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { DIRECTORY_QUERY_STALE_MS } from '@/features/file-picker/utils/directory-query'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'

export function FileRow({
  accept,
  entry,
  iconMode,
  rowProps,
  isBusy,
  mode,
  onDirectoryIntent,
  onDoubleClick,
  position,
  selected,
  setSize,
  showPath,
}: {
  accept?: readonly string[]
  entry: FsEntry
  iconMode: FilePickerIconMode
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  isBusy: boolean
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onDoubleClick: (entry: FsEntry) => void
  position: number
  selected: boolean
  setSize: number
  showPath: boolean
}) {
  const directory = isDirectoryEntry(entry)
  const pickable = isPickableEntry(entry, mode, accept)
  const availabilityLabel = fileListAvailabilityLabel(entry, mode, pickable)
  const { elementRef } = useForesight<HTMLDivElement>({
    callback: signalDirectoryIntent,
    enabled: directory && !isBusy,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: { path: entry.path },
    name: `file-picker-directory:${entry.path}`,
    reactivateAfter: DIRECTORY_QUERY_STALE_MS,
  })

  function signalDirectoryIntent() {
    if (!directory || isBusy) return

    return onDirectoryIntent(entry.path)
  }

  function handleDoubleClick() {
    if (isBusy) return

    onDoubleClick(entry)
  }

  return (
    <ListRow
      {...rowProps}
      ref={directory ? elementRef : undefined}
      disabled={isBusy}
      aria-posinset={position}
      selected={selected}
      aria-setsize={setSize}
      className={cn(
        'grid w-full cursor-default text-left',
        fileListGridClass(mode),
        !pickable && 'text-muted-foreground',
      )}
      onDoubleClick={handleDoubleClick}
      role='option'
      title={entry.path}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <EntryIcon
          className='size-(--icon-size) shrink-0'
          entry={entry}
          iconMode={iconMode}
          selected={selected}
        />
        <div className='min-w-0 flex-1 truncate'>
          <span>{entry.name}</span>
          {showPath ? (
            <span className='text-muted-foreground text-2xs ml-2'>{displayPath(entry.path)}</span>
          ) : null}
        </div>
      </div>
      {mode === 'file' ? (
        <div className='text-muted-foreground truncate'>{kindLabel(entry)}</div>
      ) : null}
      <div className='text-muted-foreground truncate tabular-nums max-sm:hidden'>
        {formatFileListModified(entry.mtimeMs)}
      </div>
      <div className='text-muted-foreground text-right tabular-nums max-sm:hidden'>
        {fileListSizeLabel(entry)}
      </div>
      {availabilityLabel ? <span className='sr-only'>{availabilityLabel}</span> : null}
    </ListRow>
  )
}
