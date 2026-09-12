import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import { useTerminalMenu } from '@/features/terminal/hooks/use-menu'
import type { TerminalMenuTarget } from '@/features/terminal/utils/commands'

/**
 * Mounted by the panel only while the menu is open, so the target it was
 * opened against stays fixed for the life of the menu.
 */
export function TerminalMenu({
  anchor,
  onOpenChange,
  target,
}: {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly target: TerminalMenuTarget
}) {
  const menu = useTerminalMenu(target)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-52'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='terminal'
    />
  )
}
