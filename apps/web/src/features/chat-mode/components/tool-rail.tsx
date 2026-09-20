import { WorkspaceRail } from '@/components/workspace-rail'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import { ToolTabIcon } from '@/features/chat-mode/components/tool-tab-icon'
import {
  CHAT_MODE_TOOL_TABS,
  chatModeToolTabLabel,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'

export function ToolRail({
  panels,
  onSelectTab,
}: {
  readonly panels: ChatModePanels
  readonly onSelectTab: (tab: ChatModeToolTab) => void
}) {
  return (
    <WorkspaceRail label='Tool tabs' side='right'>
      {CHAT_MODE_TOOL_TABS.map((tab) => (
        <ToggleIconButton
          active={panels.toolPaneOpen && panels.activeToolTab === tab}
          icon={<ToolTabIcon tab={tab} />}
          key={tab}
          label={chatModeToolTabLabel(tab)}
          tooltipSide='left'
          onClick={() => onSelectTab(tab)}
        />
      ))}
    </WorkspaceRail>
  )
}
