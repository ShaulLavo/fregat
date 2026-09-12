import { tabLabel } from '@/lib/documents/utils/labels'
import type { PickedFsEntry } from '@/lib/file-system-types'
import {
  activeEditorTabForWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { WorkbenchLayout } from '@/features/workbench/utils/layout'
import type { WorkspaceUiMode } from '@/lib/ui-mode'

export type TitlebarModel = {
  readonly documentTitle: string | null
  readonly gridTemplateColumns: string
  readonly workspaceTitle: string
}

export function titlebarModel(
  rootFolder: PickedFsEntry | null,
  panels: WorkbenchPanels,
  layout: WorkbenchLayout,
  uiMode: WorkspaceUiMode,
): TitlebarModel {
  if (!rootFolder) {
    return {
      documentTitle: null,
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      workspaceTitle: 'Platform',
    }
  }
  if (uiMode === 'chat') {
    return {
      documentTitle: null,
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      workspaceTitle: rootFolder.name,
    }
  }

  const activeTab = activeEditorTabForWorkbenchPanels(panels)
  return {
    documentTitle: activeTab ? tabLabel(activeTab.content) : 'Workbench',
    gridTemplateColumns: `${layout.outerLayout.sidebar}% minmax(0, 1fr) auto`,
    workspaceTitle: rootFolder.name,
  }
}
