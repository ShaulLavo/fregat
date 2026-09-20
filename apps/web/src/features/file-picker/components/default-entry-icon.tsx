import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry, isFileEntry } from '@/lib/file-system-types'
import { FileDashedIcon, FileIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'

export function DefaultEntryIcon({
  className,
  entry,
  open,
}: {
  className?: string
  entry: FsEntry
  open: boolean
}) {
  if (isDirectoryEntry(entry)) {
    const Icon = open ? FolderOpenIcon : FolderIcon

    return <Icon className={cn('shrink-0 text-warning', className)} weight='duotone' />
  }

  if (isFileEntry(entry)) {
    return <FileIcon className={cn('shrink-0 text-info', className)} weight='duotone' />
  }

  return <FileDashedIcon className={cn('shrink-0 text-muted-foreground', className)} />
}
