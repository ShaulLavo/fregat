import { ITEM_POSITIONS, sidebarPanelCommandId } from '@/keymap/types'
import { WORKBENCH_SIDEBAR_TABS } from '@/features/workbench/utils/panels'

/** Each sidebar tab with the numbered command that shows it, in rail order. */
export const SIDEBAR_PANEL_TARGETS = WORKBENCH_SIDEBAR_TABS.map((tab, index) => ({
  tab,
  command: sidebarPanelCommandId(ITEM_POSITIONS[index]!),
}))
