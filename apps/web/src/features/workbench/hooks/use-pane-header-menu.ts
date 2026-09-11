import { useNavigation } from '@/hooks/use-navigation'
import {
  isChatModeToolTab,
  showChatModeToolTab,
  toggleChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { isWorkbenchSidebarView, paneHeaderMenu } from '@/features/workbench/utils/pane-header-menu'
import { setWorkbenchSidebarTab } from '@/features/workbench/utils/panels'

/**
 * The header renders in both layouts, and the UI mode is what decides which one
 * owns it: the chat tool pane hosts every tool tab, the workbench sidebar hosts
 * the files/git headers. Neither host passes that down, so it is read here
 * rather than prop-drilled through the two panels they share.
 */
export function usePaneHeaderMenu(title: string) {
  const navigation = useNavigation()
  const chatModePanels = useEditorWorkspaceState((state) => state.chatModePanels)
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const workbenchPanels = useEditorWorkspaceState((state) => state.workbenchPanels)

  function selectChatView(value: string) {
    if (!isChatModeToolTab(value)) return

    void navigation.setChatModePanels(showChatModeToolTab(chatModePanels, value))
  }

  function selectSidebarView(value: string) {
    if (!isWorkbenchSidebarView(value)) return

    void navigation.setWorkbenchPanels(setWorkbenchSidebarTab(workbenchPanels, value))
  }

  // Toggling the tab that is already showing collapses the pane, and the header
  // only exists while the pane is open, so this is always the hide direction.
  function hideChatPane() {
    void navigation.setChatModePanels(
      toggleChatModeToolTab(chatModePanels, chatModePanels.activeToolTab),
    )
  }

  if (uiMode === 'chat') {
    return paneHeaderMenu({
      activeView: chatModePanels.activeToolTab,
      hidePane: hideChatPane,
      host: 'chat-pane',
      selectView: selectChatView,
      title,
    })
  }

  return paneHeaderMenu({
    activeView: workbenchPanels.activeSidebarTab,
    hidePane: null,
    host: 'workbench-sidebar',
    selectView: selectSidebarView,
    title,
  })
}
