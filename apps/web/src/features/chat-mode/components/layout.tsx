import type { GitFileStatus } from '@workspace/contracts'
import {
  PersistedResizablePanelGroup,
  ResizableHandle,
  ResizablePanel,
} from '@workspace/ui/components/resizable'
import { cn } from '@workspace/ui/lib/utils'

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
              <SessionRail />
            </ResizablePanel>
            <ResizableHandle id='sessions-handle' withHandle />
          </>
        ) : null}
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='stage' minSize={360}>
          <ChatStage />
        </ResizablePanel>
        {panels.toolPaneOpen ? (
          <>
            <ResizableHandle id='tools-handle' withHandle />
            <ResizablePanel
              className={cn(
                'border-border min-h-0 min-w-0 overflow-hidden border-l',
                // Editor and terminal paint their own content wells.
                panels.activeToolTab !== 'editor' &&
                  panels.activeToolTab !== 'terminal' &&
                  'bg-card backdrop-material',
              )}
              defaultSize={TOOL_PANE_DEFAULT_SIZE}
              id='tools'
              maxSize={TOOL_PANE_MAX_SIZE}
              minSize={TOOL_PANE_MIN_SIZE}
            >
              <ToolPane
                conflicts={conflicts}
                gitFiles={gitFiles}
                rootPath={rootPath}
                tab={panels.activeToolTab}
                workbenchPanels={workbenchPanels}
              />
            </ResizablePanel>
          </>
        ) : null}
      </PersistedResizablePanelGroup>
      <ToolRail panels={panels} onSelectTab={handleSelectToolTab} />
    </div>
  )
}
