import { useNavigation } from '@/hooks/use-navigation'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import type { GitHistoryView } from '@/lib/git-history-view'

export function useHistoryView() {
  const view = useEditorWorkspaceState((state) => state.workbenchPanels.gitHistory)
  const owner = useEditorWorkspaceStoreApi()
  const navigation = useNavigation()

  function updateView(changes: Partial<GitHistoryView>) {
    const panels = owner.getState().workbenchPanels
    return navigation.setWorkbenchPanels(
      { ...panels, gitHistory: { ...panels.gitHistory, ...changes } },
      owner,
    )
  }

  return { view, updateView }
}
