import type { FileTreeContextMenuItem, FileTreeContextMenuOpenContext } from '@workspace/tree'

import type { TreeFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { useRowMenu } from '@/features/workspace/hooks/use-row-menu'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { rectAnchor } from '@/keymap/menus/utils/virtual-anchor'
import type { TreeModel } from '@/lib/tree-model'

/**
 * Mounted by the tree only while its menu is open, so the git mutation hooks
 * can bake in this row's path at render time.
 */
export function TreeRowMenu({
  actions,
  item,
  menuContext,
  model,
  rootPath,
}: {
  readonly actions: TreeFsActions
  readonly item: FileTreeContextMenuItem
  readonly menuContext: FileTreeContextMenuOpenContext
  readonly model: TreeModel
  readonly rootPath: string
}) {
  const menu = useRowMenu({ actions, item, menuContext, model, rootPath })

  return (
    <MenuSurface
      anchor={rectAnchor(menuContext.anchorRect, menuContext.anchorElement)}
      className='w-56'
      menu={menu}
      // MenuSurface restores its captured FocusService origin after dismissal.
      onOpenChange={(next) => next || menuContext.close({ restoreFocus: false })}
      open
      // The popup portals to <body>; without this the tree's composedPath
      // outside-click check would treat our own items as outside clicks.
      popupProps={{ 'data-file-tree-context-menu-root': 'true' }}
      surface='files.row'
    />
  )
}
