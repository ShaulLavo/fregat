import { USAGE_HISTORY_DAYS } from '@workspace/contracts'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

import type { UsageDays } from '@/features/settings/utils/usage'

export function UsageRangeTabs({
  days,
  onSelect,
}: {
  readonly days: UsageDays
  readonly onSelect: (days: UsageDays) => void
}) {
  return (
    <Tabs value={days} onValueChange={(next: UsageDays) => onSelect(next)}>
      <TabsList aria-label='Usage range' variant='segmented'>
        {USAGE_HISTORY_DAYS.map((option) => (
          <TabsTab data-usage-range={option} key={option} value={option}>
            {option} days
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}
