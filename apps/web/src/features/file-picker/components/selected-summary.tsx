import type { PickedFsEntry } from '@/lib/file-system-types'
import { ProhibitIcon } from '@phosphor-icons/react'

import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { pickerCopy, type FilePickerMode } from '@/features/file-picker/utils/model'

export function SelectedSummary({
  entry,
  mode,
}: {
  entry: PickedFsEntry | null
  mode: FilePickerMode
}) {
  const copy = pickerCopy(mode)

  if (!entry) {
    return (
      <div className='text-muted-foreground flex min-w-0 items-center gap-2 text-xs'>
        <ProhibitIcon className='size-(--icon-size) shrink-0' />
        {copy.noSelectionLabel}
      </div>
    )
  }

  return (
    <div className='flex min-w-0 items-center gap-2 text-xs' title={entry.path}>
      <EntryIcon className='size-(--icon-size)' entry={entry} />
      <span className='truncate font-medium'>{entry.name}</span>
    </div>
  )
}
