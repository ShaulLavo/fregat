import { ToggleIconButton } from '@/components/toggle-icon-button'
import { WorkspaceRail } from '@/components/workspace-rail'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useNavigation } from '@/hooks/use-navigation'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import {
  ChatCircleIcon,
  FilesIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  ScrollIcon,
} from '@phosphor-icons/react'

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
  const navigation = useNavigation()

  function selectTab(tab: WorkbenchSidebarTab) {
    void navigation.setSidePanel(tab)
  }

  return (
    <aside className='bg-background backdrop-material flex h-full min-h-0 min-w-0 overflow-hidden'>
      <WorkspaceRail label='Sidebar tabs' side='left'>
        <ToggleIconButton
          active={panels.activeSidebarTab === 'files'}
          icon={<FilesIcon className='size-(--icon-size)' />}
          label={'Files'}
          tooltipSide='right'
          onClick={() => selectTab('files')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'git'}
          icon={<GitBranchIcon className='size-(--icon-size)' />}
          label={'Git'}
          tooltipSide='right'
          onClick={() => selectTab('git')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'search'}
          icon={<MagnifyingGlassIcon className='size-(--icon-size)' />}
          label={'Search'}
          tooltipSide='right'
          onClick={() => selectTab('search')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'logs'}
          icon={<ScrollIcon className='size-(--icon-size)' />}
          label={'Logs'}
          tooltipSide='right'
          onClick={() => selectTab('logs')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'chat'}
          icon={<ChatCircleIcon className='size-(--icon-size)' />}
          label={'Chat'}
          tooltipSide='right'
          onClick={() => selectTab('chat')}
        />
      </WorkspaceRail>
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
