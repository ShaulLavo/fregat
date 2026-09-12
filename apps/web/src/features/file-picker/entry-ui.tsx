import { iconForEntry } from '@/lib/file-icons'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry, isFileEntry } from '@/lib/file-system-types'
import { FileDashedIcon, FileIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'

import { fileExtension, tileTone, type FilePickerIconMode } from '@/features/file-picker/model'

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
        className={large ? 'size-10' : 'size-4'}
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

  return (
    <img
      alt=''
      aria-hidden='true'
      className={cn('shrink-0 object-contain', className)}
      draggable={false}
      src={icon.src}
    />
  )
}

export function KindBadge({ entry }: { entry: FsEntry }) {
  if (isDirectoryEntry(entry)) {
    return (
      <Badge className='border-warning/20 bg-warning/10 text-warning justify-center'>Folder</Badge>
    )
  }

  if (isFileEntry(entry)) {
    return <Badge className='border-info/20 bg-info/10 text-info justify-center'>File</Badge>
  }

  return (
    <Badge className='justify-center' variant='outline'>
      Other
    </Badge>
  )
}

function DefaultEntryIcon({
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
