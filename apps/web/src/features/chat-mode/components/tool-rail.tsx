import { RailTabs } from '@/components/rail-tabs'
import {
  CHAT_MODE_TOOL_TABS,
  chatModeToolTabLabel,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'

export function ToolRail({
  className,
  panels,
  onSelectTab,
}: {
  readonly className?: string
  readonly panels: ChatModePanels
  readonly onSelectTab: (tab: ChatModeToolTab) => void
}) {
  return (
    <RailTabs
      activeTab={panels.toolPaneOpen ? panels.activeToolTab : null}
      className={className}
      label='Tool tabs'
      side='right'
      tabLabel={chatModeToolTabLabel}
      tabs={CHAT_MODE_TOOL_TABS}
      onSelectTab={onSelectTab}
    />
  )
}
