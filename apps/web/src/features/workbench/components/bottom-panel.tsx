import { useNavigation } from '@/hooks/use-navigation'
import { TerminalIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { TerminalPanel } from '@/features/terminal/components/panel'
import { DiagnosticsPanel } from '@/features/workbench/components/diagnostics-panel'
import { type WorkbenchBottomTab, type WorkbenchPanels } from '@/features/workbench/utils/panels'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function BottomPanel({
  panels,
  rootPath,
}: {
  readonly panels: WorkbenchPanels
  readonly rootPath: string
}) {
  const navigation = useNavigation()

  function selectTab(tab: WorkbenchBottomTab) {
    void navigation.setBottomPanel(tab)
  }

  return (
    <section className='bg-content-well border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t'>
      <header className='border-border compact:h-8 flex h-9 shrink-0 items-center gap-1 border-b px-2'>
        {bottomTabButton({
          active: panels.activeBottomTab === 'terminal',
          icon: <TerminalIcon className='size-3.5' />,
          label: 'Terminal',
          onClick: () => selectTab('terminal'),
        })}
        {bottomTabButton({
          active: panels.activeBottomTab === 'problems',
          icon: <WarningCircleIcon className='size-3.5' />,
          label: 'Problems',
          onClick: () => selectTab('problems'),
        })}
      </header>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {panels.activeBottomTab === 'terminal' ? (
          <TerminalPanel active className='h-full' rootPath={rootPath} sessionId='terminal-1' />
        ) : (
          <DiagnosticsPanel />
        )}
      </div>
    </section>
  )
}

function bottomTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <Button
      aria-pressed={active}
      className={cn(
        'h-7 gap-1.5 rounded-md px-2 text-xs compact:h-6 compact:gap-1 compact:px-1.5',
        active && 'bg-accent text-accent-foreground',
      )}
      size='sm'
      type='button'
      variant='ghost'
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  )
}
