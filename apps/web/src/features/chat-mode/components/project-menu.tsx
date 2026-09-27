import { useProjectMenu } from '@/features/chat-mode/hooks/use-project-menu'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'
import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

export function ProjectMenu({
  anchor,
  onOpenChange,
  returnFocusTo,
  group,
}: {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly returnFocusTo: () => HTMLElement | null
  readonly group: SessionRailGroup
}) {
  const menu = useProjectMenu(group)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-56'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      returnFocusTo={returnFocusTo}
      surface='chat.project'
    />
  )
}
