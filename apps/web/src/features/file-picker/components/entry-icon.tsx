import { iconForEntry } from '@/lib/file-icons'
import { FileTypeIcon } from '@/components/file-type-icon'
import type { FsEntry } from '@/lib/file-system-types'
import { cn } from '@workspace/ui/lib/utils'

/** The glyph the file tree, quick open and the breadcrumbs give this entry. */
export function EntryIcon({
  className,
  entry,
  open = false,
}: {
  className?: string
  entry: FsEntry
  open?: boolean
}) {
  return (
    <FileTypeIcon
      className={cn('shrink-0 object-contain', className)}
      icon={iconForEntry(entry, { open })}
    />
  )
}
