import { CaretDownIcon, CaretUpIcon, XIcon } from '@phosphor-icons/react'
import type { ColorMode } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { usePresentation } from '@workspace/ui/patterns/sheet'

import type { StudioTab } from '@/lib/theme-studio/state/studio-store'
import { IconTooltip } from '@/components/icon-tooltip'
import { ModeSwitch } from '@/features/theme-studio/components/mode-switch'
import { DockTabs } from '@/features/theme-studio/components/dock-tabs'

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
  const phone = usePresentation() === 'sheet'

  return (
    <>
      <PaneBar className='gap-(--density-control-gap)'>
        <span className='flex min-w-0 shrink items-center gap-1.5 text-xs font-medium' title={name}>
          <span className='truncate'>{name}</span>
          {dirty ? <StatusDot aria-label='Unsaved edits' tone='warning' /> : null}
        </span>
        <ModeSwitch mode={mode} onChange={onMode} />
        {phone ? null : <DockTabs tab={tab} onTab={onTab} />}
        <span className='min-w-0 flex-1' />
        {confirmingDiscard && !phone ? (
          <span className='text-muted-foreground shrink-0 text-xs' role='status'>
            Repeat to drop your edits
          </span>
        ) : null}
        {phone && !dirty ? null : (
          <Button disabled={!dirty} size='sm' variant='ghost' onClick={onRevert}>
            Undo edits
          </Button>
        )}
        <Button disabled={!dirty} size='sm' onClick={onApply}>
          Save and use
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
      {phone && confirmingDiscard ? (
        <p className='text-muted-foreground px-(--bar-padding-x) text-xs' role='status'>
          Repeat to drop your edits
        </p>
      ) : null}
      {phone && !collapsed ? (
        <PaneBar>
          <DockTabs tab={tab} onTab={onTab} />
        </PaneBar>
      ) : null}
    </>
  )
}
