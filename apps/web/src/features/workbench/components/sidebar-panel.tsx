import type { FilesystemPath } from '@/lib/documents/utils/types'
import { cn } from '@workspace/ui/lib/utils'
import { usePanelSurface } from '@/hooks/use-panel-surface'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { SearchPane } from '@/features/workspace/components/search-pane'
import { ChatSidePanel } from '@/features/chat/components/chat-side-panel'
import { LogsPanel } from '@/features/logs/components/panel'
import { FileNavigatorPanel } from '@/features/workbench/components/file-navigator-panel'
import { GitChangesPanel } from '@/features/workbench/components/git-changes-panel'
import {
  workbenchSidebarTabLabel,
  type WorkbenchPanels,
  type WorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'

export function SidebarPanel({
  panels,
  rootPath,
}: {
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
}) {
  const surface = usePanelSurface()

  return (
    <aside
      className={cn(surface.panel, 'flex h-full min-h-0 min-w-0 overflow-hidden')}
      data-screen-sidebar=''
    >
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <RenderErrorBoundary
          label={workbenchSidebarTabLabel(panels.activeSidebarTab)}
          resetKeys={[panels.activeSidebarTab]}
        >
          {renderSidebarPanel({
            rootPath,
            tab: panels.activeSidebarTab,
          })}
        </RenderErrorBoundary>
      </div>
    </aside>
  )
}

function renderSidebarPanel({
  rootPath,
  tab,
}: {
  readonly rootPath: FilesystemPath
  readonly tab: WorkbenchSidebarTab
}) {
  if (tab === 'chat') return <ChatSidePanel rootPath={rootPath} />
  if (tab === 'git') return <GitChangesPanel rootPath={rootPath} />
  if (tab === 'logs') return <LogsPanel active />
  if (tab === 'search') return <SearchPane rootPath={rootPath} />

  return <FileNavigatorPanel rootPath={rootPath} />
}
