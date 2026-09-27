import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

import type { StudioTab } from '@/lib/theme-studio/state/studio-store'
import { STUDIO_TABS } from '@/features/theme-studio/utils/tabs'

export function DockTabs({
  tab,
  onTab,
}: {
  readonly tab: StudioTab
  readonly onTab: (tab: StudioTab) => void
}) {
  return (
    <Tabs
      className='no-scrollbar overflow-x-auto'
      value={tab}
      onValueChange={(next: StudioTab) => onTab(next)}
    >
      <TabsList aria-label='Studio'>
        {STUDIO_TABS.map((entry) => (
          <TabsTab key={entry.id} value={entry.id}>
            {entry.label}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}
