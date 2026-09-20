import { TerminalPanel } from '@/features/terminal/components/panel'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { TerminalList } from '@/features/workbench/components/terminal-list'
import { useTerminalTabActions } from '@/features/workbench/hooks/use-terminal-tab-actions'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import { Button } from '@workspace/ui/components/button'
import {
  PersistedResizablePanelGroup,
  ResizableHandle,
  ResizablePanel,
} from '@workspace/ui/components/resizable'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'
import { KeepAliveSlot } from '@/lib/keep-alive/components/keep-alive-slot'
import { useKeptIds } from '@/lib/keep-alive/hooks/use-kept-ids'

// Hidden with `visibility`, not `display` or an unmount: a remount replays
// scrollback, and a display:none host measures 0×0 so the grid comes back wrong.
const TERMINAL_SCOPE = 'workbench-terminals'
const TERMINAL_LIST_DEFAULT_SIZE = 176
const TERMINAL_LIST_MIN_SIZE = 120
const TERMINAL_LIST_MAX_SIZE = 400

export function TerminalTabs({
  panels,
  rootPath,
}: {
  readonly panels: WorkbenchPanels
  readonly rootPath: string
}) {
  const { closeTab, openTab, setProcess, setShellTitle } = useTerminalTabActions(rootPath)
  const keptId = (tabId: string) => `${TERMINAL_SCOPE}:${rootPath}:${tabId}`
  // Closing a tab is the only thing that ends its terminal; hiding one never does.
  useKeptIds(
    TERMINAL_SCOPE,
    panels.terminalTabs.map((tab) => keptId(tab.id)),
  )
  if (panels.terminalTabs.length === 0)
    return (
      <EmptyState
        action={
          <Button size='sm' type='button' variant='outline' onClick={openTab}>
            New terminal
          </Button>
        }
        className='h-full'
        title='No terminals'
      />
    )

  return (
    <PersistedResizablePanelGroup
      className='min-h-0 min-w-0'
      id='workbench-terminals'
      storageKey='workbench-terminals'
    >
      <ResizablePanel className='relative min-h-0 min-w-0' id='terminals' minSize={240}>
        {panels.terminalTabs.map((tab) => {
          const active = tab.id === panels.activeTerminalTabId
          return (
            <div
              className={cn('absolute inset-0', !active && 'invisible')}
              inert={!active}
              key={tab.id}
            >
              <KeepAliveSlot id={keptId(tab.id)} scope={TERMINAL_SCOPE}>
                {(attached) => (
                  <RenderErrorBoundary label='Terminal'>
                    <TerminalPanel
                      active={attached && active}
                      className='h-full'
                      rootPath={rootPath}
                      sessionId={tab.id}
                      // A failing shell keeps its tab so the exit message stays readable.
                      onExit={(exitCode) => {
                        if (exitCode === 0) closeTab(tab.id)
                      }}
                      onProcessChange={(process) => setProcess(tab.id, process)}
                      onTitleChange={(title) => setShellTitle(tab.id, title)}
                    />
                  </RenderErrorBoundary>
                )}
              </KeepAliveSlot>
            </div>
          )
        })}
      </ResizablePanel>
      {panels.terminalTabs.length > 1 ? (
        <>
          <ResizableHandle id='terminal-list-handle' withHandle />
          <ResizablePanel
            className='min-h-0 min-w-0 overflow-hidden'
            defaultSize={TERMINAL_LIST_DEFAULT_SIZE}
            id='terminal-list'
            maxSize={TERMINAL_LIST_MAX_SIZE}
            minSize={TERMINAL_LIST_MIN_SIZE}
          >
            <RenderErrorBoundary label='Terminal list'>
              <TerminalList
                activeTabId={panels.activeTerminalTabId}
                rootPath={rootPath}
                tabs={panels.terminalTabs}
              />
            </RenderErrorBoundary>
          </ResizablePanel>
        </>
      ) : null}
    </PersistedResizablePanelGroup>
  )
}
