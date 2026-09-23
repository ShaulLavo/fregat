import { PanelTabIcon } from '@/components/panel-tab-icon'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import type { PanelTab } from '@/components/utils/panel-tabs'
import { WorkspaceRail } from '@/components/workspace-rail'

/**
 * The tab strip both rails show. A mode passes its own tabs and its own labels;
 * `activeTab` is null when closed. Clicking the active tab closes its panel.
 */
export function RailTabs<Tab extends PanelTab>({
  activeTab,
  className,
  label,
  side,
  tabLabel,
  tabs,
  onSelectTab,
}: {
  readonly activeTab: Tab | null
  readonly className?: string
  readonly label: string
  readonly side: 'left' | 'right'
  readonly tabLabel: (tab: Tab) => string
  readonly tabs: readonly Tab[]
  readonly onSelectTab: (tab: Tab, open: boolean) => void
}) {
  return (
    <WorkspaceRail className={className} label={label} side={side}>
      {tabs.map((tab) => (
        <ToggleIconButton
          active={activeTab === tab}
          icon={<PanelTabIcon tab={tab} />}
          key={tab}
          label={tabLabel(tab)}
          tooltipSide={side === 'left' ? 'right' : 'left'}
          onClick={() => onSelectTab(tab, activeTab !== tab)}
        />
      ))}
    </WorkspaceRail>
  )
}
