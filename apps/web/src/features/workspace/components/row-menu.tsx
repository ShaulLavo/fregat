import type { TreeFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { useRowMenu, type TreeContextMenuItem } from '@/features/workspace/hooks/use-row-menu'
import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import type { TreeModel } from '@/lib/tree-model'

export type TreeRowMenuHandle = {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly returnFocusTo: () => HTMLElement | null
}

/**
 * Mounted by the tree only while its menu is open, so the git mutation hooks
 * can bake in this row's path at render time.
 */
export function TreeRowMenu({
  actions,
  item,
  menu,
  model,
  rootPath,
}: {
  readonly actions: TreeFsActions
  readonly item: TreeContextMenuItem
  readonly menu: TreeRowMenuHandle
  readonly model: TreeModel
  readonly rootPath: string
}) {
  const rowMenu = useRowMenu({ actions, item, model, rootPath })

  return (
    <MenuSurface
      anchor={menu.anchor}
      className='w-56'
      menu={rowMenu}
      onOpenChange={menu.onOpenChange}
      open
      returnFocusTo={menu.returnFocusTo}
      surface='files.row'
    />
  )
}
