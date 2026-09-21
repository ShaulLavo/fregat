import { usePanelSurface } from '@/hooks/use-panel-surface'
import type { GitFileStatus } from '@workspace/contracts'
import {
  PersistedResizablePanelGroup,
  ResizableHandle,
  ResizablePanel,
} from '@workspace/ui/components/resizable'
import { cn } from '@workspace/ui/lib/utils'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

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
  const surface = usePanelSurface()

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
      <div className='relative z-10 flex min-h-0 min-w-0 flex-1'>
        <PersistedResizablePanelGroup
          className='min-h-0 min-w-0 flex-1'
          id='chat-mode'
          storageKey='chat-mode'
        >
          {panels.sessionRailOpen ? (
            <>
              <ResizablePanel
                className={cn('h-full min-h-0 overflow-hidden', surface.panel)}
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
          <ResizablePanel
            className={cn('min-h-0 min-w-0 overflow-hidden', surface.panel)}
            id='stage'
            minSize={360}
          >
            <ChatStage />
          </ResizablePanel>
          {panels.toolPaneOpen ? (
            <>
              <ResizableHandle id='tools-handle' withHandle />
              <ResizablePanel
                className={cn('min-h-0 min-w-0 overflow-hidden', surface.panel)}
                defaultSize={TOOL_PANE_DEFAULT_SIZE}
                id='tools'
                maxSize={TOOL_PANE_MAX_SIZE}
                minSize={TOOL_PANE_MIN_SIZE}
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
                    workbenchPanels={workbenchPanels}
                  />
                </RenderErrorBoundary>
              </ResizablePanel>
            </>
          ) : null}
        </PersistedResizablePanelGroup>
        <ToolRail className={surface.panel} panels={panels} onSelectTab={handleSelectToolTab} />
      </div>
    </div>
  )
}
