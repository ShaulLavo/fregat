import { iconForEntry } from '@/lib/file-icons'
import { FileTypeIcon } from '@/components/file-type-icon'
import type { FsEntry } from '@/lib/file-system-types'
import type { FilePickerIconMode } from '@/features/file-picker/utils/model'
import { DefaultEntryIcon } from '@/features/file-picker/components/default-entry-icon'
import { cn } from '@workspace/ui/lib/utils'

export function EntryIcon({
  className,
  entry,
  iconMode,
  open,
  selected,
}: {
  className?: string
  entry: FsEntry
  iconMode: FilePickerIconMode
  open?: boolean
  selected: boolean
}) {
  const openFolder = open ?? selected

  if (iconMode === 'default') {
    return <DefaultEntryIcon className={className} entry={entry} open={openFolder} />
  }

  const icon = iconForEntry(entry, { open: openFolder })

  return <FileTypeIcon className={cn('shrink-0 object-contain', className)} icon={icon} />
}
