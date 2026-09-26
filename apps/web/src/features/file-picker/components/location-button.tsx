import { Button } from '@workspace/ui/components/button'
import { ContextMenu, ContextMenuTrigger } from '@workspace/ui/components/context-menu'
import { cn } from '@workspace/ui/lib/utils'

import { LocationIcon } from '@/features/file-picker/components/location-icon'
import { LocationMenu } from '@/features/file-picker/components/location-menu'
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
    <ContextMenu>
      <ContextMenuTrigger className='block'>
        <Button
          aria-current={selected ? 'page' : undefined}
          className={cn(
            SIDEBAR_NAV_BUTTON_BASE_CLASS,
            selected && SIDEBAR_NAV_BUTTON_SELECTED_CLASS,
            !selected && SIDEBAR_NAV_BUTTON_IDLE_CLASS,
          )}
          onClick={() => jumpTo(location.path)}
          title={location.title}
          type='button'
          variant='ghost'
        >
          <LocationIcon location={location} selected={selected} />
          <span className='truncate'>{location.label}</span>
          {location.detail ? (
            <span className='text-muted-foreground text-2xs ml-auto shrink-0 font-mono tabular-nums'>
              {location.detail}
            </span>
          ) : null}
        </Button>
      </ContextMenuTrigger>
      <LocationMenu location={location} />
    </ContextMenu>
  )
}
