import type { FileTreeContextMenuItem, FileTreeVisibleRow } from '@workspace/tree'
import { getTreeRowAriaLabel } from '@/features/workspace/utils/tree-row-identity'

// Sticky overlay rows are separate DOM mirrors of the real row. Prefer them
// when anchoring the menu so it follows the row the user can see.
export function getContextMenuAnchorButton(
  path: string | null,
  stickyButtonRefs: ReadonlyMap<string, HTMLElement>,
  rowButtons: ReadonlyMap<string, HTMLElement>,
): HTMLElement | null {
  if (path == null) {
    return null
  }

  const stickyButton = stickyButtonRefs.get(path) ?? null
  if (stickyButton != null) {
    return stickyButton
  }

  const rowButton = rowButtons.get(path) ?? null
  return rowButton?.dataset.itemParked === 'true' ? null : rowButton
}

export function createContextMenuItem(
  row: FileTreeVisibleRow,
  path: string,
): FileTreeContextMenuItem {
  return {
    kind: row.kind,
    name: getTreeRowAriaLabel(row),
    path,
  }
}
