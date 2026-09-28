import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type {
  FileTreeContextMenuItem,
  FileTreeController,
  FileTreeVisibleRow,
} from '@workspace/tree'

import type { TreeRowDom } from '@/features/workspace/hooks/use-tree-row-dom'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import {
  createContextMenuItem,
  getContextMenuAnchorButton,
} from '@/features/workspace/utils/tree-context-menu-anchor'

/** How a row menu was asked for: a right-click, or the menu key on the focused row. */
export type TreeMenuTrigger =
  | { readonly kind: 'pointer'; readonly event: ReactMouseEvent<HTMLElement> }
  | {
      readonly kind: 'key'
      readonly event: ReactKeyboardEvent<HTMLElement>
      readonly element: HTMLElement
    }

export type TreeMenuRequest = (item: FileTreeContextMenuItem, trigger: TreeMenuTrigger) => void

/** What the host hands the menu it renders for the open row. */
export type TreeRowMenuHandle = {
  readonly anchor: MenuAnchor
  readonly onOpenChange: (open: boolean) => void
  readonly returnFocusTo: () => HTMLElement | null
}

/**
 * Focuses the row and asks the host to open its menu. A sticky row keeps its place: focus moves
 * without revealing the canonical row, which the layout effect would otherwise scroll to.
 */
export function openTreeRowMenu({
  claimDomFocus,
  controller,
  dom,
  markActiveItem,
  onOpenMenu,
  preserveStickyAtScrollTop,
  row,
  targetPath,
  trigger,
}: {
  readonly claimDomFocus: () => void
  readonly controller: FileTreeController
  readonly dom: TreeRowDom
  readonly markActiveItem: (path: string) => void
  readonly onOpenMenu: TreeMenuRequest
  readonly preserveStickyAtScrollTop: (path: string, scrollTop: number | null) => void
  readonly row: FileTreeVisibleRow
  readonly targetPath: string
  readonly trigger: TreeMenuTrigger
}): void {
  const item = controller.getItem(targetPath)
  if (item == null) return

  const anchorButton = getContextMenuAnchorButton(
    targetPath,
    dom.getStickyRowButtons(),
    dom.getRowButtons(),
  )
  if (anchorButton?.dataset.fileTreeStickyRow === 'true') {
    preserveStickyAtScrollTop(targetPath, dom.getScroll()?.scrollTop ?? null)
    claimDomFocus()
    markActiveItem(targetPath)
  }
  item.focus()
  onOpenMenu(createContextMenuItem(row, targetPath), trigger)
}
