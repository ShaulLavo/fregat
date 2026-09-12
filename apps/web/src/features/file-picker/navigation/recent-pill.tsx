import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import {
  PILL_NAV_BUTTON_BASE_CLASS,
  PILL_NAV_BUTTON_IDLE_CLASS,
  PILL_NAV_BUTTON_SELECTED_CLASS,
} from '@/features/file-picker/navigation/navigation-styles'

export function RecentPill({ currentPath, entry }: { currentPath: string; entry: FsEntry }) {
  const { revealEntry } = useFilePickerSessionActions()
  const selected = isDirectoryEntry(entry) && currentPath === entry.path

  return (
    <Button
      aria-current={selected ? 'page' : undefined}
      className={cn(
        PILL_NAV_BUTTON_BASE_CLASS,
        selected && PILL_NAV_BUTTON_SELECTED_CLASS,
        !selected && PILL_NAV_BUTTON_IDLE_CLASS,
      )}
      onClick={() => revealEntry(entry)}
      size='sm'
      type='button'
      variant='ghost'
    >
      {entry.name}
    </Button>
  )
}
