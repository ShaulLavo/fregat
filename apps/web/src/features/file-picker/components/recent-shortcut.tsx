import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'

import {
  SIDEBAR_NAV_BUTTON_BASE_CLASS,
  SIDEBAR_NAV_BUTTON_IDLE_CLASS,
  SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
} from '@/features/file-picker/utils/navigation-styles'

export function RecentShortcut({ currentPath, entry }: { currentPath: string; entry: FsEntry }) {
  const { revealEntry } = useFilePickerSessionActions()
  const selected = isDirectoryEntry(entry) && currentPath === entry.path

  return (
    <Button
      aria-current={selected ? 'page' : undefined}
      className={cn(
        SIDEBAR_NAV_BUTTON_BASE_CLASS,
        selected && SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
        !selected && SIDEBAR_NAV_BUTTON_IDLE_CLASS,
      )}
      onClick={() => revealEntry(entry)}
      title={entry.path}
      type='button'
      variant='ghost'
    >
      <EntryIcon
        className='size-(--icon-size)'
        entry={entry}
        iconMode='default'
        selected={selected}
      />
      <span className='truncate'>{entry.name}</span>
    </Button>
  )
}
