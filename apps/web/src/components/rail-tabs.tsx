import { PanelTabIcon } from '@/components/panel-tab-icon'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import type { PanelTab } from '@/components/utils/panel-tabs'
import { WorkspaceRail } from '@/components/workspace-rail'

/**
 * The tab strip both rails show. A mode passes its own tabs and its own labels;
 * `activeTab` is null when the panel is closed, so no tab reads as pressed.
 */
export function RailTabs<Tab extends PanelTab>({
  activeTab,
  label,
  side,
  tabLabel,
  tabs,
  onSelectTab,
}: {
  readonly activeTab: Tab | null
  readonly label: string
  readonly side: 'left' | 'right'
  readonly tabLabel: (tab: Tab) => string
  readonly tabs: readonly Tab[]
  readonly onSelectTab: (tab: Tab) => void
}) {
  return (
    <WorkspaceRail label={label} side={side}>
      {tabs.map((tab) => (
        <ToggleIconButton
          active={activeTab === tab}
          icon={<PanelTabIcon tab={tab} />}
          key={tab}
          label={tabLabel(tab)}
          tooltipSide={side === 'left' ? 'right' : 'left'}
          onClick={() => onSelectTab(tab)}
        />
      ))}
    </WorkspaceRail>
  )
}
