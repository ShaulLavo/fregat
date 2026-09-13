import type { PickedFsEntry } from '@/lib/file-system-types'
import type { WorkbenchLayout } from '@/features/workbench/utils/layout'
import type { WorkspaceUiMode } from '@/lib/ui-mode'

export type TitlebarModel = {
  readonly gridTemplateColumns: string
  readonly workspaceTitle: string
}

export function titlebarModel(
  rootFolder: PickedFsEntry | null,
  layout: WorkbenchLayout,
  uiMode: WorkspaceUiMode,
): TitlebarModel {
  if (!rootFolder) {
    return { gridTemplateColumns: 'minmax(0, 1fr) auto', workspaceTitle: 'Platform' }
  }
  if (uiMode === 'chat') {
    return { gridTemplateColumns: 'minmax(0, 1fr) auto', workspaceTitle: rootFolder.name }
  }

  return {
    gridTemplateColumns: `${layout.outerLayout.sidebar}% minmax(0, 1fr) auto`,
    workspaceTitle: rootFolder.name,
  }
}
