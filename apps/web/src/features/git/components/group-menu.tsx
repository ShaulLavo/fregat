import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

import { useGroupMenu } from '../hooks/use-group-menu'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'

/**
 * Mounted by the group header only while its menu is open, so the bulk
 * mutations bind to this group's paths at render time.
 */
export function GroupMenu({
  anchor,
  onOpenChange,
  rootPath,
  rows,
  section,
}: {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly rootPath: string
  readonly rows: readonly ChangeRow[]
  readonly section: PanelSection
}) {
  const menu = useGroupMenu(rows, section, rootPath)

  return (
    <MenuSurface
      anchor={anchor}
      className='w-60'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='git.group'
    />
  )
}
