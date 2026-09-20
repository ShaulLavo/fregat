import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useNavigation } from '@/hooks/use-navigation'
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
import { type WorkbenchBottomTab, type WorkbenchPanels } from '@/features/workbench/utils/panels'
import { cn } from '@workspace/ui/lib/utils'

export function BottomPanel({
  panels,
  rootPath,
}: {
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
}) {
  const navigation = useNavigation()
  const terminalActive = panels.activeBottomTab === 'terminal'

  function selectTab(tab: WorkbenchBottomTab) {
    void navigation.setBottomPanel(tab)
  }

  return (
    <ToolPane
      className='h-full min-w-0 overflow-hidden'
      header={null}
      bodyClassName='relative flex overflow-hidden bg-content-well'
      subheader={
        <PaneBar className={cn(BAR_TAB_STRIP_CLASS, 'bg-background px-0')}>
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
    >
      {/* The strip stays mounted behind Problems: unmounting a terminal detaches
          its PTY, and the server kills a detached session once its TTL expires.
          Hidden with `visibility`, not `display` — a display:none host measures
          0x0 and the grid comes back reflowed. */}
      <div
        className={cn('absolute inset-0', !terminalActive && 'invisible')}
        inert={!terminalActive}
      >
        <RenderErrorBoundary label='Terminal'>
          <TerminalTabs panels={panels} rootPath={rootPath} visible={terminalActive} />
        </RenderErrorBoundary>
      </div>
      {terminalActive ? null : (
        <div className='absolute inset-0'>
          <RenderErrorBoundary label='Problems'>
            <DiagnosticsPanel />
          </RenderErrorBoundary>
        </div>
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
