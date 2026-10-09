import { useForesight } from '@/hooks/use-foresight'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { displayPath } from '@/features/file-picker/utils/model'
import {
  ENTRY_NAME_TEXT,
  FILE_LIST_GRID,
  formatFileListModified,
} from '@/features/file-picker/utils/rows'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { DIRECTORY_QUERY_STALE_MS } from '@/features/file-picker/utils/directory-query'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { FILE_PICKER_INTENT_PREFIX } from '@/features/file-picker/utils/intent'

export function FileRow({
  entry,
  rowProps,
  isBusy,
  onDirectoryIntent,
  onDoubleClick,
  position,
  selected,
  setSize,
  showPath,
}: {
  entry: FsEntry
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  isBusy: boolean
  onDirectoryIntent: (path: string) => void
  onDoubleClick: (entry: FsEntry) => void
  position: number
  selected: boolean
  setSize: number
  showPath: boolean
}) {
  const directory = isDirectoryEntry(entry)
  const { elementRef } = useForesight<HTMLDivElement>({
    callback: signalDirectoryIntent,
    enabled: directory && !isBusy,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: { path: entry.path },
    name: `${FILE_PICKER_INTENT_PREFIX}${entry.path}`,
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
      className={cn('grid w-full cursor-default text-left', FILE_LIST_GRID)}
      onDoubleClick={handleDoubleClick}
      role='option'
      title={entry.path}
    >
      <div className='flex min-w-0 items-center gap-(--density-control-gap)'>
        <EntryIcon className='size-(--icon-size) shrink-0' entry={entry} open={selected} />
        <div className='min-w-0 flex-1 truncate'>
          <span className={ENTRY_NAME_TEXT}>{entry.name}</span>
          {showPath ? (
            <span className='text-muted-foreground text-2xs ml-2'>{displayPath(entry.path)}</span>
          ) : null}
        </div>
      </div>
      <div className='text-muted-foreground truncate tabular-nums max-sm:hidden'>
        {formatFileListModified(entry.mtimeMs)}
      </div>
    </ListRow>
  )
}
