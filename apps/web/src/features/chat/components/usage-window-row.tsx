import type { ProviderUsageWindow } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

import { TickerNumber } from '@/components/ticker-number'
import {
  formatResetIn,
  USAGE_TONE_FILL,
  USAGE_TONE_TEXT,
  usagePace,
  usagePaceLabel,
  usageWindowTone,
} from '@/features/chat/utils/usage-meter'

export function UsageWindowRow({
  nowMs,
  window,
}: {
  readonly nowMs: number
  readonly window: ProviderUsageWindow
}) {
  const tone = usageWindowTone(window)
  const resetIn = formatResetIn(window.resetsAt, nowMs)
  const pace = usagePace(window, nowMs)

  return (
    <li className='flex flex-col gap-1' data-usage-window={window.id} data-tone={tone}>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-muted-foreground'>{window.label}</span>
        <span className={cn('tabular-nums', tone === 'muted' ? null : USAGE_TONE_TEXT[tone])}>
          <TickerNumber size='xs' value={Math.round(window.usedPercent)} />%
        </span>
      </div>
      <div className='bg-muted relative h-1 rounded-full'>
        <div
          data-usage-fill
          className={cn('h-full rounded-full', USAGE_TONE_FILL[tone])}
          style={{ width: `${window.usedPercent}%` }}
        />
        {/* Where even spending would stand: fill past it is use ahead of time. */}
        {pace ? (
          <div
            aria-hidden='true'
            className='bg-foreground absolute -top-0.5 h-2 w-0.5 rounded-full'
            data-usage-pace-marker
            style={{ left: `calc(${pace.elapsedPercent}% - 1px)` }}
          />
        ) : null}
      </div>
      <div className='text-2xs flex flex-wrap justify-between gap-x-2 tabular-nums'>
        {resetIn ? <span className='text-muted-foreground'>Resets in {resetIn}</span> : null}
        {pace ? (
          <span
            className={pace.verdict === 'ahead' ? 'text-warning' : 'text-muted-foreground'}
            data-usage-pace={pace.verdict}
          >
            {usagePaceLabel(pace)}
          </span>
        ) : null}
      </div>
    </li>
  )
}
