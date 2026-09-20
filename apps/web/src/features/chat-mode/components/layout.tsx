import type { GitFileStatus } from '@workspace/contracts'
import {
  PersistedResizablePanelGroup,
  ResizableHandle,
  ResizablePanel,
} from '@workspace/ui/components/resizable'
import { cn } from '@workspace/ui/lib/utils'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { useState } from 'react'

import { useCollapsiblePanel } from '@/hooks/use-collapsible-panel'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { ChatStage } from '@/features/chat-mode/components/chat-stage'
import { SessionRail } from '@/features/chat-mode/components/session-rail'
import { ToolPane } from '@/features/chat-mode/components/tool-pane'
import { ToolRail } from '@/features/chat-mode/components/tool-rail'
import {
  SESSION_RAIL_DEFAULT_SIZE,
  SESSION_RAIL_MAX_SIZE,
  SESSION_RAIL_MIN_SIZE,
  TOOL_PANE_DEFAULT_SIZE,
  TOOL_PANE_MAX_SIZE,
  TOOL_PANE_MIN_SIZE,
  chatModeToolTabLabel,
  toggleChatModeToolTab,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'

import { Wallpaper } from '@/features/workbench/components/wallpaper'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'

export function ChatModeLayout({
  conflicts,

  gitFiles,
  panels,
  rootPath,
  workbenchPanels,
  onPanelsChange,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles: readonly GitFileStatus[]
  readonly panels: ChatModePanels
  readonly rootPath: string
  readonly workbenchPanels: WorkbenchPanels
  readonly onPanelsChange: (panels: ChatModePanels) => void
}) {
  const toolsOpen = panels.toolPaneOpen
  const toolsRef = useCollapsiblePanel(toolsOpen)
  // A session terminal spawns on mount, so the pane joins the group on its first open.
  const [toolsOpened, setToolsOpened] = useState(toolsOpen)
  if (toolsOpen && !toolsOpened) setToolsOpened(true)

  function handleLayoutChanged(next: Record<string, number>) {
    // Dragged shut rather than toggled: the open flag has to follow.
    if (toolsOpen && next.tools === 0) onPanelsChange({ ...panels, toolPaneOpen: false })
  }

  function handleSelectToolTab(tab: ChatModeToolTab) {
    onPanelsChange(toggleChatModeToolTab(panels, tab))
  }

  return (
    <div
      aria-label='Chat workspace'
      className='text-foreground relative isolate flex h-full min-h-0 min-w-0 overflow-hidden'
      data-chat-mode=''
      role='application'
    >
      <Wallpaper />
      <PersistedResizablePanelGroup
        className='relative z-10 min-h-0 min-w-0 flex-1'
        id='chat-mode'
        storageKey='chat-mode'
        onLayoutChanged={handleLayoutChanged}
      >
        {panels.sessionRailOpen ? (
          <>
            <ResizablePanel
              className='h-full min-h-0 overflow-hidden'
              defaultSize={SESSION_RAIL_DEFAULT_SIZE}
              id='sessions'
              maxSize={SESSION_RAIL_MAX_SIZE}
              minSize={SESSION_RAIL_MIN_SIZE}
            >
              <RenderErrorBoundary label='Sessions'>
                <SessionRail />
              </RenderErrorBoundary>
            </ResizablePanel>
            <ResizableHandle id='sessions-handle' withHandle />
          </>
        ) : null}
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='stage' minSize={360}>
          <ChatStage />
        </ResizablePanel>
        {toolsOpen ? <ResizableHandle id='tools-handle' withHandle /> : null}
        {toolsOpened ? (
          // Closing collapses instead of unmounting, which would reconnect the terminals.
          <ResizablePanel
            collapsible
            className={cn(
              'min-h-0 min-w-0 overflow-hidden',
              // Editor and terminal paint their own content wells.
              panels.activeToolTab !== 'editor' &&
                panels.activeToolTab !== 'terminal' &&
                'bg-card backdrop-material',
            )}
            collapsedSize={0}
            defaultSize={TOOL_PANE_DEFAULT_SIZE}
            id='tools'
            inert={!toolsOpen}
            maxSize={TOOL_PANE_MAX_SIZE}
            minSize={TOOL_PANE_MIN_SIZE}
            panelRef={toolsRef}
          >
            <RenderErrorBoundary
              label={chatModeToolTabLabel(panels.activeToolTab)}
              resetKeys={[panels.activeToolTab]}
            >
              <ToolPane
                conflicts={conflicts}
                gitFiles={gitFiles}
                rootPath={rootPath}
                tab={panels.activeToolTab}
                visible={toolsOpen}
                workbenchPanels={workbenchPanels}
              />
            </RenderErrorBoundary>
          </ResizablePanel>
        ) : null}
      </PersistedResizablePanelGroup>
      <ToolRail panels={panels} onSelectTab={handleSelectToolTab} />
    </div>
  )
}
