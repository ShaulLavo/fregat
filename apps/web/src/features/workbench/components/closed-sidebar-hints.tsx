import { PanelTabIcon } from '@/components/panel-tab-icon'
import { ShortcutHintBadge } from '@/components/shortcut-hint-badge'
import { SIDEBAR_PANEL_TARGETS } from '@/features/workbench/utils/sidebar-panel-commands'
import { useAnyShortcutHint } from '@/keymap/hooks/use-any-shortcut-hint'

const COMMANDS = SIDEBAR_PANEL_TARGETS.map((target) => target.command)

/**
 * While the sidebar is hidden, holding the panel modifiers shows its numbered tabs where
 * the rail was. It overlays the content and takes no pointer input; releasing hides it.
 */
export function ClosedSidebarHints() {
  const showing = useAnyShortcutHint(COMMANDS)
  if (!showing) return null

  return (
    <div
      aria-hidden='true'
      className='bg-popover-solid ring-foreground/10 pointer-events-none absolute inset-y-0 left-0 z-20 flex w-(--rail-width) flex-col items-center gap-1 p-1 ring-1'
      data-closed-sidebar-hints=''
    >
      {SIDEBAR_PANEL_TARGETS.map((target) => (
        <span
          className='text-muted-foreground relative flex size-(--density-control-height-sm) items-center justify-center'
          key={target.tab}
        >
          <PanelTabIcon tab={target.tab} />
          <ShortcutHintBadge className='-right-0.5 -bottom-0.5' command={target.command} />
        </span>
      ))}
    </div>
  )
}
