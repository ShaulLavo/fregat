import { useState } from 'react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useSettingValue } from '@/hooks/use-setting-value'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { matchesWorkspaceRoot, toTreePath } from '@/lib/path-formatters'

/**
 * The editor's active file as this composer's optional context, workspace-relative, when the
 * setting is on. Removing the chip lasts until the active file changes.
 */
export function useActiveFileChip(rootPath: string) {
  const enabled = useSettingValue('chat.activeFileContext')
  const activePath = useEditorWorkspaceState((state) => {
    const tab = activeEditorTab(state.workbenchPanels.editorGroups)
    return tab ? (tabFileResource(tab.content)?.path ?? null) : null
  })
  const [dismissal, setDismissal] = useState({ path: activePath, removed: false })
  if (dismissal.path !== activePath) setDismissal({ path: activePath, removed: false })
  const shown =
    enabled &&
    activePath &&
    !(dismissal.path === activePath && dismissal.removed) &&
    matchesWorkspaceRoot(activePath, rootPath)

  return {
    path: shown ? toTreePath(activePath, rootPath) : null,
    remove: () => setDismissal({ path: activePath, removed: true }),
  }
}
