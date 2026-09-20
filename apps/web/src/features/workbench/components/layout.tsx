import type { GitFileStatus } from '@workspace/contracts'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'

import { useState } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'

import { BottomPanel } from '@/features/workbench/components/bottom-panel'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { SidebarPanel } from '@/features/workbench/components/sidebar-panel'
import { Wallpaper } from '@/features/workbench/components/wallpaper'
import { useCollapsiblePanel } from '@/hooks/use-collapsible-panel'
import {
  isBottomCollapsed,
  setWorkbenchMainLayout,
  setWorkbenchOuterLayout,
  type WorkbenchLayout,
} from '@/features/workbench/utils/layout'
import {
  BOTTOM_MAX_SIZE,
  BOTTOM_MIN_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'

export function WorkbenchLayout({
  conflicts,

  gitFiles,
  layout,
  panels,
  rootPath,
  onLayoutChange,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles: readonly GitFileStatus[]
  readonly layout: WorkbenchLayout
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
  readonly onLayoutChange: (layout: WorkbenchLayout) => void
}) {
  function handleOuterLayoutChanged(next: Record<string, number>) {
    onLayoutChange(setWorkbenchOuterLayout(layout, next))
  }

  const navigation = useNavigation()
  const bottomOpen = panels.bottomPanelOpen
  const bottomRef = useCollapsiblePanel(bottomOpen)
  // Terminals spawn on mount, so the panel joins the group on its first open.
  const [bottomOpened, setBottomOpened] = useState(bottomOpen)
  if (bottomOpen && !bottomOpened) setBottomOpened(true)

  function handleMainLayoutChanged(next: Record<string, number>) {
    if (!isBottomCollapsed(next)) {
      onLayoutChange(setWorkbenchMainLayout(layout, next))
      return
    }
    // Dragged shut rather than toggled: the open flag has to follow.
    if (bottomOpen) void navigation.setWorkbenchPanels({ ...panels, bottomPanelOpen: false })
  }

  return (
    <div
      aria-label='Workbench'
      className='text-foreground relative isolate flex h-full min-h-0 min-w-0 overflow-hidden'
      data-workbench=''
      role='application'
    >
      <Wallpaper />
      <ResizablePanelGroup
        className='relative z-10 min-h-0 min-w-0 flex-1'
        defaultLayout={layout.outerLayout}
        id='workbench-outer'
        onLayoutChanged={handleOuterLayoutChanged}
      >
        {panels.sidebarOpen ? (
          <>
            <ResizablePanel
              className='h-full min-h-0 overflow-hidden'
              id='sidebar'
              maxSize={SIDEBAR_MAX_SIZE}
              minSize={SIDEBAR_MIN_SIZE}
            >
              <SidebarPanel panels={panels} rootPath={rootPath} />
            </ResizablePanel>
            <ResizableHandle id='sidebar-handle' withHandle />
          </>
        ) : null}
        <ResizablePanel className='min-h-0 min-w-0' id='main' minSize={360}>
          <ResizablePanelGroup
            className='min-h-0 min-w-0'
            defaultLayout={layout.mainLayout}
            id='workbench-main'
            orientation='vertical'
            onLayoutChanged={handleMainLayoutChanged}
          >
            <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='editor' minSize={160}>
              <CodePanel
                conflicts={conflicts}
                gitFiles={gitFiles}
                panels={panels}
                rootPath={rootPath}
              />
            </ResizablePanel>
            {bottomOpen ? <ResizableHandle id='bottom-handle' withHandle /> : null}
            {bottomOpened ? (
              // Closing collapses instead of unmounting: a remounted terminal reconnects
              // and replays its scrollback, losing scroll position.
              <ResizablePanel
                collapsible
                className='min-h-0 min-w-0 overflow-hidden'
                collapsedSize={0}
                id='bottom'
                inert={!bottomOpen}
                maxSize={BOTTOM_MAX_SIZE}
                minSize={BOTTOM_MIN_SIZE}
                panelRef={bottomRef}
              >
                <BottomPanel panels={panels} rootPath={rootPath} visible={bottomOpen} />
              </ResizablePanel>
            ) : null}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
