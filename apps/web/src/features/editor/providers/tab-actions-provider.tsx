import type { ReactNode } from 'react'

import type { RequestCloseTab, RequestCloseTabs } from '@/features/editor/hooks/use-dirty-tab-close'
import {
  EditorTabActionsContext,
  type EditorTabActions,
} from '@/features/editor/providers/tab-actions-context'
import { useEditorGroupActions } from '@/features/editor/hooks/use-editor-group-actions'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { groupForTab } from '@/lib/documents/utils/groups'

export function EditorTabActionsProvider({
  children,
  requestCloseTab,
  requestCloseTabs,
}: {
  readonly children: ReactNode
  readonly requestCloseTab: RequestCloseTab
  readonly requestCloseTabs: RequestCloseTabs
}) {
  const commands = useEditorGroupActions()
  const workspace = useEditorWorkspaceStoreApi()
  const value: EditorTabActions = {
    requestCloseTab,
    requestCloseTabs,
    selectTab: (tabId) => {
      const group = groupForTab(workspace.getState().workbenchPanels.editorGroups, tabId)
      if (group) void commands.selectTab({ groupId: group.id, tabId })
    },
  }

  return <EditorTabActionsContext value={value}>{children}</EditorTabActionsContext>
}
