import { PanelTabIcon } from '@/components/panel-tab-icon'
import { ShortcutHintBadge } from '@/components/shortcut-hint-badge'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import type { PanelTab } from '@/components/utils/panel-tabs'
import { useKeyShortcuts } from '@/keymap/hooks/use-key-shortcuts'
import type { PlatformCommandId } from '@/keymap/types'

export function RailTab({
  active,
  command,
  label,
  tab,
  tooltipSide,
  onClick,
}: {
  readonly active: boolean
  /** The numbered command that shows this tab, if it has one. */
  readonly command: PlatformCommandId | null
  readonly label: string
  readonly tab: PanelTab
  readonly tooltipSide: 'left' | 'right'
  readonly onClick: () => void
}) {
  const keyShortcuts = useKeyShortcuts(command)

  return (
    <span className='relative flex'>
      <ToggleIconButton
        active={active}
        icon={<PanelTabIcon tab={tab} />}
        keyShortcuts={keyShortcuts}
        label={label}
        tooltipSide={tooltipSide}
        onClick={onClick}
      />
      <ShortcutHintBadge className='-right-0.5 -bottom-0.5' command={command} />
    </span>
  )
}
