import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { LocationIcon } from '@/features/file-picker/components/location-icon'
import {
  SIDEBAR_NAV_BUTTON_BASE_CLASS,
  SIDEBAR_NAV_BUTTON_IDLE_CLASS,
  SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
} from '@/features/file-picker/utils/navigation-styles'
import type { SidebarLocation } from '@/features/file-picker/utils/sidebar-locations'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'

export function LocationButton({
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
        SIDEBAR_NAV_BUTTON_BASE_CLASS,
        selected && SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
        !selected && SIDEBAR_NAV_BUTTON_IDLE_CLASS,
      )}
      onClick={() => jumpTo(location.path)}
      title={location.path}
      type='button'
      variant='ghost'
    >
      <LocationIcon location={location} selected={selected} />
      <span className='truncate'>{location.label}</span>
    </Button>
  )
}
