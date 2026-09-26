import { cloneElement, type ReactElement, type DOMAttributes } from 'react'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

import { useSessionMenu } from '@/features/chat-mode/hooks/use-session-menu'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/keymap/menus/components/surface'

export function SessionMenu({
  session,
  trigger,
}: {
  readonly session: SessionRailItem
  readonly trigger: ReactElement<DOMAttributes<HTMLElement>>
}) {
  const menu = useSessionMenu(session)
  const contextMenu = useContextMenu()

  return (
    <>
      {cloneElement(trigger, {
        onContextMenu: (event) => contextMenu.openAtEvent(event, event.currentTarget),
        onKeyDown: (event) => {
          if (contextMenu.openOnMenuKey(event)) return
          trigger.props.onKeyDown?.(event)
        },
      })}
      <MenuSurface
        className='w-56'
        menu={menu}
        surface='chat.session'
        anchor={contextMenu.anchor}
        open={contextMenu.open}
        onOpenChange={contextMenu.onOpenChange}
      />
    </>
  )
}
