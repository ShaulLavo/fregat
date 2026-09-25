import { RailTab } from '@/components/rail-tab'
import type { PanelTab } from '@/components/utils/panel-tabs'
import { railTabCommand } from '@/components/utils/rail-tab-command'
import { WorkspaceRail } from '@/components/workspace-rail'
import { usePaneHost } from '@/hooks/use-pane-host'
import type { PaneHostView } from '@/providers/pane-host-context'

/**
 * The tab strip both rails show, drawn from the enclosing pane host. A tab is
 * pressed while its pane shows it; clicking the pressed tab hides the pane.
 */
export function RailTabs({
  className,
  label,
  side,
}: {
  readonly className?: string
  readonly label: string
  readonly side: 'left' | 'right'
}) {
  const host = usePaneHost()
  const views: readonly PaneHostView<PanelTab>[] = host?.views ?? []

  return (
    <WorkspaceRail className={className} label={label} side={side}>
      {views.map((view, index) => (
        <RailTab
          active={host?.visible === true && host.activeView === view.value}
          command={railTabCommand(host?.kind, index)}
          key={view.value}
          label={view.label}
          tab={view.value}
          tooltipSide={side === 'left' ? 'right' : 'left'}
          onClick={view.toggle}
        />
      ))}
    </WorkspaceRail>
  )
}
