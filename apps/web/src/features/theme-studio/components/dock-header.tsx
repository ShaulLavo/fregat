import { CaretDownIcon, CaretUpIcon, XIcon } from '@phosphor-icons/react'
import type { ColorMode } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

import type { StudioTab } from '@/lib/theme-studio/state/studio-store'
import { IconTooltip } from '@/components/icon-tooltip'
import { ModeSwitch } from '@/features/theme-studio/components/mode-switch'
import { STUDIO_TABS } from '@/features/theme-studio/utils/tabs'

export function DockHeader({
  collapsed,
  confirmingDiscard,
  dirty,
  mode,
  name,
  tab,
  onApply,
  onClose,
  onMode,
  onRevert,
  onTab,
  onToggleCollapsed,
}: {
  collapsed: boolean
  confirmingDiscard: boolean
  dirty: boolean
  mode: ColorMode
  name: string
  tab: StudioTab
  onApply: () => void
  onClose: () => void
  onMode: (mode: ColorMode) => void
  onRevert: () => void
  onTab: (tab: StudioTab) => void
  onToggleCollapsed: () => void
}) {
  return (
    <PaneBar className='gap-(--density-control-gap)'>
      <span className='flex min-w-0 shrink items-center gap-1.5 text-xs font-medium' title={name}>
        <span className='truncate'>{name}</span>
        {dirty ? <StatusDot aria-label='Not applied' tone='warning' /> : null}
      </span>
      <ModeSwitch mode={mode} onChange={onMode} />
      <Tabs value={tab} onValueChange={(next: StudioTab) => onTab(next)}>
        <TabsList aria-label='Studio'>
          {STUDIO_TABS.map((entry) => (
            <TabsTab key={entry.id} value={entry.id}>
              {entry.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      <span className='min-w-0 flex-1' />
      {confirmingDiscard ? (
        <span className='text-muted-foreground shrink-0 text-xs' role='status'>
          Repeat to discard edits
        </span>
      ) : null}
      <Button disabled={!dirty} size='sm' variant='ghost' onClick={onRevert}>
        Revert
      </Button>
      <Button disabled={!dirty} size='sm' onClick={onApply}>
        Apply
      </Button>
      <IconTooltip label={collapsed ? 'Show the studio' : 'Hide the studio'}>
        <Button
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show the studio' : 'Hide the studio'}
          size='icon-sm'
          variant='ghost'
          onClick={onToggleCollapsed}
        >
          {collapsed ? <CaretUpIcon /> : <CaretDownIcon />}
        </Button>
      </IconTooltip>
      <IconTooltip label='Close'>
        <Button aria-label='Close' size='icon-sm' variant='ghost' onClick={onClose}>
          <XIcon />
        </Button>
      </IconTooltip>
    </PaneBar>
  )
}
