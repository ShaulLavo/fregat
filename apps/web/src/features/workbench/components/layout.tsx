import type { GitFileStatus } from '@workspace/contracts'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'

import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'

import { BottomPanel } from '@/features/workbench/components/bottom-panel'
import { CodePanel } from '@/features/workbench/components/code-panel'
import { SidebarPanel } from '@/features/workbench/components/sidebar-panel'
import { Wallpaper } from '@/features/workbench/components/wallpaper'
import {
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

  function handleMainLayoutChanged(next: Record<string, number>) {
    onLayoutChange(setWorkbenchMainLayout(layout, next))
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
            {panels.bottomPanelOpen ? (
              <>
                <ResizableHandle id='bottom-handle' withHandle />
                <ResizablePanel
                  className='min-h-0 min-w-0 overflow-hidden'
                  id='bottom'
                  maxSize={BOTTOM_MAX_SIZE}
                  minSize={BOTTOM_MIN_SIZE}
                >
                  <BottomPanel panels={panels} rootPath={rootPath} />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
