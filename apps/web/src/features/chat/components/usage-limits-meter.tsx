import { GaugeIcon } from '@phosphor-icons/react'
import type { ProviderAccountUsage } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { TickerNumber } from '@/components/ticker-number'
import { useCoarseNow } from '@/features/chat/hooks/use-coarse-now'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import {
  formatPlanType,
  liveUsageWindows,
  tightestUsageWindow,
  USAGE_TONE_TEXT,
  usageCheckedLabel,
  usageWindowLabel,
  usageWindowTone,
} from '@/features/chat/utils/usage-meter'
import { UsageWindowRow } from './usage-window-row'

/**
 * How much of the account's plan is left, beside the context ring and deliberately
 * unlike it: a gauge for the account, a ring for the conversation. The trigger shows
 * the window that will stop the agent first; the popover lists every window.
 */
export function UsageLimitsMeter({
  account,
  compact = false,
}: {
  readonly account: ProviderAccountUsage
  /** Narrow composer: the gauge alone, with the readout left to the popover. */
  readonly compact?: boolean
}) {
  const nowMs = useCoarseNow()
  const bus = useCommandBus()
  const [open, setOpen] = useState(false)
  const windows = liveUsageWindows(account.windows, nowMs)
  const tightest = tightestUsageWindow(windows)
  if (!tightest) return null

  const tone = usageWindowTone(tightest)
  const label = usageWindowLabel(tightest, nowMs)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={label}
                  className={cn(
                    'h-auto cursor-pointer gap-1 px-1 py-0.5 font-normal',
                    USAGE_TONE_TEXT[tone],
                  )}
                  data-tone={tone}
                  data-usage-meter
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <GaugeIcon aria-hidden className='size-(--icon-size) shrink-0' />
                  {compact ? null : (
                    <span className='text-2xs tabular-nums'>
                      <TickerNumber value={Math.round(tightest.usedPercent)} />%
                    </span>
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-64 text-xs' data-usage-popover side='top'>
        <div className='flex items-baseline justify-between gap-3'>
          <span className='text-muted-foreground font-medium'>Plan usage</span>
          {account.planType ? (
            <span className='text-muted-foreground'>{formatPlanType(account.planType)}</span>
          ) : null}
        </div>
        <ul className='mt-2 flex flex-col gap-2.5'>
          {windows.map((window) => (
            <UsageWindowRow key={window.id} nowMs={nowMs} window={window} />
          ))}
        </ul>
        <div className='mt-2.5 flex items-center justify-between gap-2'>
          <p className='text-muted-foreground text-2xs tabular-nums' data-usage-checked>
            {usageCheckedLabel(account.checkedAt, nowMs)}
          </p>
          <Button
            onClick={() => {
              setOpen(false)
              bus.dispatch('workspace.showUsage', {
                source: { kind: 'programmatic', caller: 'usage-meter' },
              })
            }}
            size='sm'
            type='button'
            variant='ghost'
          >
            View usage
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
