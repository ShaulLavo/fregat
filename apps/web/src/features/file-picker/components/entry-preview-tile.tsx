import type { FsEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'

/** An entry's glyph at tile size, for the icons grid and the preview's fallback. */
export function EntryPreviewTile({ entry }: { entry: FsEntry }) {
  return (
    <span className='bg-muted flex size-20 shrink-0 items-center justify-center rounded-md [&>svg]:size-(--picker-tile-icon-size)'>
      <EntryIcon entry={entry} />
    </span>
  )
}
