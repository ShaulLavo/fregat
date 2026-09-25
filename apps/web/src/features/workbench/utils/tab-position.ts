import { ITEM_POSITIONS, type ItemPosition } from '@workspace/client-core/commands/item-position'

import { activeEditorGroup } from '@/lib/documents/utils/groups'
import type { TabId } from '@/lib/documents/utils/types'
import type { WorkspaceUiMode } from '@/lib/ui-mode'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'

/**
 * The number the select-item keys give a tab: its place in the active group's strip.
 * Chat mode numbers chats instead, so no tab has one there.
 */
export function editorTabPosition(
  panels: WorkbenchPanels,
  uiMode: WorkspaceUiMode,
  tabId: TabId,
): ItemPosition | null {
  if (uiMode !== 'workbench') return null
  const tabs = activeEditorGroup(panels.editorGroups).tabs
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index >= 8 && index === tabs.length - 1) return 9
  return index < 8 ? (ITEM_POSITIONS[index] ?? null) : null
}
