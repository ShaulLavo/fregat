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
} from '@/features/workbench/utils/bar-tabs'
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
    <section className='border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t'>
      <header className={cn(BAR_TAB_STRIP_CLASS, 'bg-background')}>
        <div aria-label='Bottom panel tabs' className='flex shrink-0 items-stretch' role='tablist'>
          {bottomTab({
            active: terminalActive,
            icon: <TerminalIcon className='size-3.5' />,
            label: 'Terminal',
            onClick: () => selectTab('terminal'),
          })}
          {bottomTab({
            active: panels.activeBottomTab === 'problems',
            count: <ProblemCount />,
            icon: <WarningCircleIcon className='size-3.5' />,
            label: 'Problems',
            onClick: () => selectTab('problems'),
          })}
        </div>
        <div aria-hidden='true' className={BAR_TAB_FILLER_CLASS} />
        {terminalActive ? <TerminalActions rootPath={rootPath} /> : null}
      </header>
      <div className='bg-content-well flex min-h-0 flex-1 overflow-hidden'>
        {terminalActive ? (
          <TerminalTabs panels={panels} rootPath={rootPath} />
        ) : (
          <DiagnosticsPanel />
        )}
      </div>
    </section>
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
