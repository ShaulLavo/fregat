import type { FsEntry } from '@/lib/file-system-types'
import { isFileEntry } from '@/lib/file-system-types'
import { cn } from '@workspace/ui/lib/utils'
import {
  fileExtension,
  tileTone,
  type FilePickerIconMode,
} from '@/features/file-picker/utils/model'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'

export function EntryPreviewTile({
  entry,
  iconMode,
  selected,
  size,
}: {
  entry: FsEntry
  iconMode: FilePickerIconMode
  selected: boolean
  size: 'sm' | 'lg'
}) {
  const large = size === 'lg'
  const extension = isFileEntry(entry) ? fileExtension(entry.name) : ''

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-md border',
        large ? 'size-24' : 'size-7',
        tileTone(entry, selected),
      )}
    >
      <EntryIcon
        entry={entry}
        className={large ? 'size-(--icon-size)' : 'size-(--icon-size)'}
        iconMode={iconMode}
        selected={selected}
      />
      {large && extension && (
        <span className='bg-background/90 text-muted-foreground ring-border text-3xs absolute right-1.5 bottom-1.5 rounded-md px-1 py-0.5 font-medium uppercase ring-1'>
          {extension}
        </span>
      )}
    </span>
  )
}
