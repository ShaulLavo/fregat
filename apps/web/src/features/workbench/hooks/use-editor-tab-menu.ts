import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { useEditorTabActions } from '@/features/editor/hooks/use-editor-tab-actions'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorGroupActions } from '@/features/editor/hooks/use-editor-group-actions'
import { editorTabMenu } from '@/features/workbench/utils/editor-tab-menu'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { allEditorGroups, groupForTab } from '@/lib/documents/utils/groups'
import { useGroupSplitAvailability } from '@/features/workbench/hooks/use-group-split-availability'

export function useEditorTabMenu(
  tab: EditorTabModel,
  closeTargets: readonly EditorTabCloseTarget[],
  open: boolean,
) {
  const { requestCloseTabs } = useEditorTabActions()
  const commands = useEditorCommands()
  const actions = useEditorGroupActions()
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const group = groupForTab(groups, tab.id)
  const splits = useGroupSplitAvailability(group?.id ?? null, open)
  const copyable = tab.content.kind === 'document' && tab.content.document.kind !== 'search'

  return editorTabMenu({
    closeTargets,
    closeTabs: (tabIds) => requestCloseTabs(tabIds),
    copyPath: (path, label) => void copyTextToClipboard(path, label),
    openFile: (path) => commands.selectFile(path),
    canSplitRight: copyable && splits.right,
    canSplitDown: copyable && splits.down,
    canMoveToGroup: !!group && allEditorGroups(groups).length > 1,
    split: (edge) => {
      if (!group) return
      void actions.placeTab({
        tabId: tab.id,
        mode: 'copy',
        target: { kind: 'edge', groupId: group.id, edge },
      })
    },
    moveToGroup: () => commands.requestMoveTab(tab.id),
    tab,
  })
}
