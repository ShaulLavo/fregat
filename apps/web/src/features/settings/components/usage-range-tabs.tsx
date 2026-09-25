import { USAGE_HISTORY_DAYS } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import type { UsageDays } from '@/features/settings/utils/usage'

export function UsageRangeTabs({
  days,
  onSelect,
}: {
  readonly days: UsageDays
  readonly onSelect: (days: UsageDays) => void
}) {
  return (
    <div aria-label='Usage range' className='flex items-center gap-1' role='group'>
      {USAGE_HISTORY_DAYS.map((option) => (
        <Button
          aria-pressed={option === days}
          className='text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground'
          data-usage-range={option}
          key={option}
          onClick={() => onSelect(option)}
          size='sm'
          type='button'
          variant='ghost'
        >
          {option} days
        </Button>
      ))}
    </div>
  )
}
