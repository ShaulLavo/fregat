import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

import { useFileMenu } from '../hooks/use-file-menu'
import type { ChangeRow } from '@/features/git/utils/types'

/**
 * Mounted by the row only while its menu is open, so the mutation hooks bind
 * to this row's path at render time and idle rows pay nothing for a menu
 * nobody asked for.
 */
export function FileMenu({
  anchor,
  onOpenChange,
  rootPath,
  row,
}: {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly rootPath: string
  readonly row: ChangeRow
}) {
  const menu = useFileMenu(row, rootPath)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-56'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='git.file'
    />
  )
}
