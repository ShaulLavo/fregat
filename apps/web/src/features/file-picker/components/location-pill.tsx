import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import {
  PILL_NAV_BUTTON_BASE_CLASS,
  PILL_NAV_BUTTON_IDLE_CLASS,
  PILL_NAV_BUTTON_SELECTED_CLASS,
} from '@/features/file-picker/utils/navigation-styles'
import type { SidebarLocation } from '@/features/file-picker/utils/sidebar-locations'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'

export function LocationPill({
  currentPath,
  location,
}: {
  currentPath: string
  location: SidebarLocation
}) {
  const { jumpTo } = useFilePickerSessionActions()
  const selected = currentPath === location.path

  return (
    <Button
      aria-current={selected ? 'page' : undefined}
      className={cn(
        PILL_NAV_BUTTON_BASE_CLASS,
        selected && PILL_NAV_BUTTON_SELECTED_CLASS,
        !selected && PILL_NAV_BUTTON_IDLE_CLASS,
      )}
      onClick={() => jumpTo(location.path)}
      size='sm'
      type='button'
      variant='ghost'
    >
      {location.label}
    </Button>
  )
}
