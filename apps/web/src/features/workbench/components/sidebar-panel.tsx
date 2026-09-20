import { ToggleIconButton } from '@/components/toggle-icon-button'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useNavigation } from '@/hooks/use-navigation'
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
import { type WorkbenchPanels, type WorkbenchSidebarTab } from '@/features/workbench/utils/panels'

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
    <aside className='bg-background backdrop-material border-border flex h-full min-h-0 min-w-0 overflow-hidden border-r'>
      <nav
        aria-label='Sidebar tabs'
        className='border-border flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-r p-1'
      >
        <ToggleIconButton
          active={panels.activeSidebarTab === 'files'}
          icon={<FilesIcon className='size-4' />}
          label={'Files'}
          onClick={() => selectTab('files')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'git'}
          icon={<GitBranchIcon className='size-4' />}
          label={'Git'}
          onClick={() => selectTab('git')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'search'}
          icon={<MagnifyingGlassIcon className='size-4' />}
          label={'Search'}
          onClick={() => selectTab('search')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'logs'}
          icon={<ScrollIcon className='size-4' />}
          label={'Logs'}
          onClick={() => selectTab('logs')}
        />
        <ToggleIconButton
          active={panels.activeSidebarTab === 'chat'}
          icon={<ChatCircleIcon className='size-4' />}
          label={'Chat'}
          onClick={() => selectTab('chat')}
        />
      </nav>
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        {renderSidebarPanel({
          rootPath,
          tab: panels.activeSidebarTab,
        })}
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
