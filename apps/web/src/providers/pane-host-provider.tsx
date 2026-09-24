import type { ReactNode } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import {
  CHAT_MODE_TOOL_TABS,
  chatModeToolTabLabel,
  showChatModeToolTab,
  toggleChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  showWorkbenchBottomTab,
  showWorkbenchSidebarTab,
  toggleWorkbenchBottomTab,
  toggleWorkbenchSidebarTab,
  WORKBENCH_BOTTOM_TABS,
  WORKBENCH_SIDEBAR_TABS,
  workbenchBottomTabLabel,
  workbenchSidebarTabLabel,
} from '@/features/workbench/utils/panels'
import {
  PaneHostContext,
  type PaneHost,
  type PaneHostKind,
  type PaneHostView,
} from '@/providers/pane-host-context'

/**
 * Names the container its children render in. A layout mounts one around its
 * rail or tab strip and one around the pane body, so both ask the same host.
 */
export function PaneHostProvider({
  children,
  kind,
}: {
  readonly children: ReactNode
  readonly kind: PaneHostKind
}) {
  const host = usePaneHostValue(kind)

  return <PaneHostContext value={host}>{children}</PaneHostContext>
}

function usePaneHostValue(kind: PaneHostKind): PaneHost {
  const navigation = useNavigation()
  const owner = useEditorWorkspaceStoreApi()
  const chat = useEditorWorkspaceState((state) => state.chatModePanels)
  const workbench = useEditorWorkspaceState((state) => state.workbenchPanels)

  if (kind === 'chat-tools') {
    const views = CHAT_MODE_TOOL_TABS.map((tab): PaneHostView<typeof tab> => ({
      label: chatModeToolTabLabel(tab),
      value: tab,
      select: () => void navigation.setChatModePanels(showChatModeToolTab(chat, tab), owner),
      toggle: () => void navigation.setChatModePanels(toggleChatModeToolTab(chat, tab), owner),
    }))
    return {
      kind,
      views,
      activeView: chat.activeToolTab,
      visible: chat.toolPaneOpen,
      hide: () => void navigation.setChatModePanels({ ...chat, toolPaneOpen: false }, owner),
    }
  }
  if (kind === 'workbench-bottom') {
    const views = WORKBENCH_BOTTOM_TABS.map((tab): PaneHostView<typeof tab> => ({
      label: workbenchBottomTabLabel(tab),
      value: tab,
      select: () =>
        void navigation.setWorkbenchPanels(showWorkbenchBottomTab(workbench, tab), owner),
      toggle: () =>
        void navigation.setWorkbenchPanels(toggleWorkbenchBottomTab(workbench, tab), owner),
    }))
    return {
      kind,
      views,
      activeView: workbench.activeBottomTab,
      visible: workbench.bottomPanelOpen,
      hide: () =>
        void navigation.setWorkbenchPanels({ ...workbench, bottomPanelOpen: false }, owner),
    }
  }

  const views = WORKBENCH_SIDEBAR_TABS.map((tab): PaneHostView<typeof tab> => ({
    label: workbenchSidebarTabLabel(tab),
    value: tab,
    select: () =>
      void navigation.setWorkbenchPanels(showWorkbenchSidebarTab(workbench, tab), owner),
    toggle: () =>
      void navigation.setWorkbenchPanels(toggleWorkbenchSidebarTab(workbench, tab), owner),
  }))
  return {
    kind,
    views,
    activeView: workbench.activeSidebarTab,
    visible: workbench.sidebarOpen,
    hide: () => void navigation.setWorkbenchPanels({ ...workbench, sidebarOpen: false }, owner),
  }
}
