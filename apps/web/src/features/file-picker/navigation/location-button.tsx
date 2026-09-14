import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import {
  SIDEBAR_NAV_BUTTON_BASE_CLASS,
  SIDEBAR_NAV_BUTTON_IDLE_CLASS,
  SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
} from '@/features/file-picker/navigation/navigation-styles'
import type { SidebarLocation } from '@/features/file-picker/navigation/sidebar-locations'
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
  const Icon = selected && 'openIcon' in location ? location.openIcon : location.icon

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
      <Icon
        className={cn('size-4 shrink-0', selected ? 'text-info' : 'text-muted-foreground')}
        weight='duotone'
      />
      <span className='truncate'>{location.label}</span>
    </Button>
  )
}
