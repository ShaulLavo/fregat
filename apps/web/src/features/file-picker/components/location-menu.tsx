import { EyeIcon, PushPinIcon, PushPinSlashIcon, XIcon } from '@phosphor-icons/react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@workspace/ui/components/context-menu'

import { usePickerLocationActions } from '@/features/file-picker/hooks/use-picker-location-actions'
import type { SidebarLocation } from '@/features/file-picker/utils/sidebar-locations'

/** Pin, unpin or remove one sidebar row; brings removed rows back. */
export function LocationMenu({ location }: { location: SidebarLocation }) {
  const actions = usePickerLocationActions()

  return (
    <ContextMenuContent>
      {location.pinned ? (
        <ContextMenuItem onClick={() => actions.unpin(location.path)}>
          <PushPinSlashIcon className='size-(--icon-size)' /> Unpin
        </ContextMenuItem>
      ) : (
        <>
          <ContextMenuItem onClick={() => actions.pin(location.path)}>
            <PushPinIcon className='size-(--icon-size)' /> Pin
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.hide(location.path)}>
            <XIcon className='size-(--icon-size)' /> Remove from sidebar
          </ContextMenuItem>
        </>
      )}
      {actions.hiddenCount > 0 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={actions.restoreHidden}>
            <EyeIcon className='size-(--icon-size)' /> Show removed locations
            <span className='text-muted-foreground text-2xs ml-auto font-mono tabular-nums'>
              {actions.hiddenCount}
            </span>
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  )
}
