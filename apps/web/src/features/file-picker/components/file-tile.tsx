import { useQueryClient } from '@tanstack/react-query'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import type { FsEntry } from '@/lib/file-system-types'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { EntryPreviewTile } from '@/features/file-picker/components/entry-preview-tile'
import { FileThumbnail } from '@/features/file-picker/components/file-thumbnail'
import type { FilePickerIconMode } from '@/features/file-picker/utils/model'
import { previewImageUrl, previewKind } from '@/features/file-picker/utils/preview'

/** One entry in the icons grid: an image's own thumbnail, or the entry's icon tile. */
export function FileTile({
  entry,
  iconMode,
  isBusy,
  rowProps,
  selected,
  onDoubleClick,
}: {
  entry: FsEntry
  iconMode: FilePickerIconMode
  isBusy: boolean
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
  onDoubleClick: (entry: FsEntry) => void
}) {
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))

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
        {previewKind(entry) === 'image' ? (
          <FileThumbnail
            className='h-20'
            entry={entry}
            iconMode={iconMode}
            src={previewImageUrl(origin, entry.path)}
          />
        ) : (
          <EntryPreviewTile entry={entry} iconMode={iconMode} selected={selected} size='lg' />
        )}
      </span>
      <span className='w-full truncate text-center text-xs'>{entry.name}</span>
    </ListRow>
  )
}
