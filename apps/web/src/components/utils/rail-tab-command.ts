import { ITEM_POSITIONS, sidebarPanelCommandId } from '@/keymap/types'
import type { PaneHostKind } from '@/providers/pane-host-context'

/** The numbered command that shows a rail tab. Only the workbench sidebar has them. */
export function railTabCommand(kind: PaneHostKind | undefined, index: number) {
  const position = ITEM_POSITIONS[index]
  if (kind !== 'workbench-sidebar' || !position) return null
  return sidebarPanelCommandId(position)
}
