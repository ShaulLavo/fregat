import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { useQueryClient } from '@tanstack/react-query'
import { killTerminalTab } from '@/features/workbench/state/kill-terminal-tab'
import {
  openTerminalTabInWorkbenchPanels,
  renameTerminalTabInWorkbenchPanels,
  reorderTerminalTabInWorkbenchPanels,
  selectTerminalTabInWorkbenchPanels,
  setTerminalTabProcessInWorkbenchPanels,
  setTerminalTabShellTitleInWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { focusTargetById } from '@/lib/focus/state/service'

// Writes the store directly, not through navigation: terminal tabs have no address token.
export function useTerminalTabActions(rootPath: string) {
  const store = useEditorWorkspaceStoreApi()
  const focus = useFocusService()
  const queryClient = useQueryClient()
  const server = {
    client: clientForQueryClient(queryClient),
    origin: originForQueryClient(queryClient),
  }

  function update(next: (panels: WorkbenchPanels) => WorkbenchPanels) {
    const panels = next(store.getState().workbenchPanels)
    store.getState().setWorkbenchPanels(panels)
    return panels
  }

  function focusTerminal(sessionId: string | null) {
    if (!sessionId) return

    void focus.request(focusTargetById({ kind: 'terminal', rootPath, sessionId })).completion
  }

  function terminalOwnsFocus(sessionId: string) {
    const owner = focus.getSnapshot().currentOwner
    return owner?.id.kind === 'terminal' && owner.id.sessionId === sessionId
  }

  return {
    // Also the exit handler: a shell ending in a background tab must not pull focus.
    closeTab: (tabId: string) => {
      const ownedFocus = terminalOwnsFocus(tabId)
      const panels = update((current) => killTerminalTab(current, server, rootPath, tabId))
      if (ownedFocus) focusTerminal(panels.activeTerminalTabId)
    },
    openTab: () => {
      const panels = update(openTerminalTabInWorkbenchPanels)
      focusTerminal(panels.activeTerminalTabId)
    },
    renameTab: (tabId: string, name: string) => {
      update((current) => renameTerminalTabInWorkbenchPanels(current, tabId, name))
    },
    setProcess: (tabId: string, process: string | null) => {
      update((current) => setTerminalTabProcessInWorkbenchPanels(current, tabId, process))
    },
    setShellTitle: (tabId: string, shellTitle: string) => {
      update((current) => setTerminalTabShellTitleInWorkbenchPanels(current, tabId, shellTitle))
    },
    reorderTab: (tabId: string, targetIndex: number) => {
      update((current) => reorderTerminalTabInWorkbenchPanels(current, tabId, targetIndex))
    },
    selectTab: (tabId: string) => {
      update((current) => selectTerminalTabInWorkbenchPanels(current, tabId))
    },
    activateTab: (tabId: string) => {
      update((current) => selectTerminalTabInWorkbenchPanels(current, tabId))
      focusTerminal(tabId)
    },
  }
}
