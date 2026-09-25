import type { ProviderUsageHistory } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'

import {
  formatUsageDay,
  formatModelCost,
  usageDays,
  visibleUsageDay,
} from '@/features/settings/utils/usage'

/**
 * Spend per day, one series. Bars measure cost when any is known and tokens otherwise,
 * so a Codex-only range without prices still shows its shape.
 */
export function UsageDayChart({
  byCost,
  hidden,
  history,
}: {
  readonly byCost: boolean
  /** Models taken out through the legend. */
  readonly hidden: ReadonlySet<string>
  readonly history: ProviderUsageHistory
}) {
  const days = usageDays(history).map((day) => visibleUsageDay(day, hidden))
  const measure = (day: (typeof days)[number]) => (byCost ? (day.costUsd ?? 0) : day.tokens)
  const peak = Math.max(...days.map(measure), 0)
  const first = days[0]
  const last = days.at(-1)

  return (
    <figure className='flex flex-col gap-1' data-usage-chart>
      <figcaption className='text-muted-foreground text-2xs'>
        {byCost ? 'Estimated cost per day' : 'Tokens per day'}
      </figcaption>
      <div className='flex h-20 items-end gap-0.5' role='list'>
        {days.map((day) => {
          const unpriced =
            day.unpricedTokens > 0
              ? `, ${formatContextTokens(day.unpricedTokens)} unpriced tokens`
              : ''
          const label = `${formatUsageDay(day.day)}: ${byCost ? `${formatModelCost(day)} estimated, ` : ''}${formatContextTokens(day.tokens)} tokens${unpriced}`
          const share = peak > 0 ? measure(day) / peak : 0
          // Measured by cost, a day of only unpriced usage would draw nothing and read as quiet.
          const unpricedOnly = byCost && share === 0 && day.unpricedTokens > 0

          return (
            <div
              aria-label={label}
              className='flex h-full min-w-0 flex-1 items-end'
              data-tooltip={label}
              key={day.day}
              role='listitem'
            >
              {share > 0 ? (
                <div
                  className='bg-muted-foreground w-full rounded-t-md'
                  style={{ height: `max(2px, ${share * 100}%)` }}
                />
              ) : null}
              {unpricedOnly ? <div className='bg-muted h-1 w-full rounded-t-md' /> : null}
            </div>
          )
        })}
      </div>
      <div className='text-muted-foreground text-3xs flex justify-between tabular-nums'>
        <span>{first ? formatUsageDay(first.day) : null}</span>
        <span>{last ? formatUsageDay(last.day) : null}</span>
      </div>
    </figure>
  )
}
