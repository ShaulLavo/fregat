import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'
import type { NavigationResult } from '@/state/navigation-coordinator'

export function useEditorGroupActions() {
  const commands = useEditorCommands()
  const workspace = useEditorWorkspaceStoreApi()
  const focus = useFocusService()

  async function focusAfter(operation: Promise<NavigationResult>) {
    const result = await operation
    if (result.status !== 'applied') return
    const state = workspace.getState()
    const tab = activeEditorTab(state.workbenchPanels.editorGroups)
    if (!tab) return
    const document = tab.content.kind === 'document' ? tab.content.document : null
    const identity = {
      tabId: tab.id,
      layout: state.uiMode,
      diffPath:
        document && (document.kind === 'git-diff' || document.kind === 'compare-saved')
          ? documentSourcePath(document)
          : null,
      searchRoot: document?.kind === 'search' ? document.root : null,
    }
    focus.request(
      {
        kind: 'match',
        matches: (target) => matchesActiveSurface(target, identity),
        isValid: () => {
          const current = workspace.getState()
          return (
            current.rootFolder === state.rootFolder &&
            current.uiMode === state.uiMode &&
            activeEditorTab(current.workbenchPanels.editorGroups)?.id === tab.id
          )
        },
      },
      'focus',
    )
  }

  return {
    placeTab: (...args: Parameters<typeof commands.placeTab>) =>
      focusAfter(commands.placeTab(...args)),
    selectTab: (...args: Parameters<typeof commands.selectTab>) =>
      focusAfter(commands.selectTab(...args)),
  }
}
