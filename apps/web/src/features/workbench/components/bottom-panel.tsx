import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { usePaneHost } from '@/hooks/use-pane-host'
import { PaneHeaderMenu } from '@/components/pane-header-menu'
import { TerminalIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { ProblemCount } from '@/features/workbench/components/problem-count'
import { TerminalActions } from '@/features/workbench/components/terminal-actions'
import { TerminalTabs } from '@/features/workbench/components/terminal-tabs'
import {
  BAR_TAB_FILLER_CLASS,
  BAR_TAB_STRIP_CLASS,
  barTabClassName,
} from '@workspace/ui/patterns/bar-tabs'
import {
  workbenchBottomTabLabel,
  type WorkbenchBottomTab,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { cn } from '@workspace/ui/lib/utils'

export function BottomPanel({
  panels,
  rootPath,
}: {
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
}) {
  const host = usePaneHost()
  const terminalActive = panels.activeBottomTab === 'terminal'

  function selectTab(tab: WorkbenchBottomTab) {
    host?.views.find((view) => view.value === tab)?.select()
  }

  return (
    <ToolPane
      className='h-full min-w-0 overflow-hidden'
      header={null}
      bodyClassName='flex'
      scroll={false}
      subheader={
        <PaneHeaderMenu
          title={workbenchBottomTabLabel(panels.activeBottomTab)}
          trigger={
            <PaneBar className={cn(BAR_TAB_STRIP_CLASS, 'px-0')}>
              <div
                aria-label='Bottom panel tabs'
                className='flex shrink-0 items-stretch'
                role='tablist'
              >
                {bottomTab({
                  active: terminalActive,
                  icon: <TerminalIcon className='size-(--icon-size-sm)' />,
                  label: 'Terminal',
                  onClick: () => selectTab('terminal'),
                })}
                {bottomTab({
                  active: panels.activeBottomTab === 'problems',
                  count: <ProblemCount />,
                  icon: <WarningCircleIcon className='size-(--icon-size-sm)' />,
                  label: 'Problems',
                  onClick: () => selectTab('problems'),
                })}
              </div>
              <div aria-hidden='true' className={BAR_TAB_FILLER_CLASS} />
              {terminalActive ? <TerminalActions rootPath={rootPath} /> : null}
            </PaneBar>
          }
        />
      }
    >
      {terminalActive ? (
        <RenderErrorBoundary label='Terminal'>
          <TerminalTabs panels={panels} rootPath={rootPath} />
        </RenderErrorBoundary>
      ) : (
        <RenderErrorBoundary label='Problems'>
          <DiagnosticsPanel />
        </RenderErrorBoundary>
      )}
    </ToolPane>
  )
}

function bottomTab({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly count?: ReactNode
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-selected={active}
      className={barTabClassName(active, 'focus-ring-inset outline-none')}
      role='tab'
      type='button'
      onClick={onClick}
    >
      {icon}
      {label}
      {count}
    </button>
  )
}
