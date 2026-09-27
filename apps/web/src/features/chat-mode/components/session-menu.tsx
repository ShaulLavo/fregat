import { useSessionMenu } from '@/features/chat-mode/hooks/use-session-menu'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

export function SessionMenu({
  anchor,
  onOpenChange,
  returnFocusTo,
  session,
}: {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly returnFocusTo: () => HTMLElement | null
  readonly session: SessionRailItem
}) {
  const menu = useSessionMenu(session)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-56'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      returnFocusTo={returnFocusTo}
      surface='chat.session'
    />
  )
}
