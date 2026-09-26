import type { ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { TickerNumber } from '@/components/ticker-number'
import { ContextUsageDetails } from '@/features/chat/components/context-usage-details'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'

import {
  contextUsageTone,
  formatContextTokens,
  type ContextUsage,
} from '@workspace/client-core/chat/context-usage'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Context occupancy for the active session. The gauge still renders when the
 * provider reports tokens without a window size — it shows the count instead of
 * a percentage rather than vanishing, because "no window reported" and "no
 * usage yet" are different states and hiding both told the user neither.
 *
 * The popover holds the breakdown; the tooltip names the compact gauge.
 */
export function ContextUsageRing({
  compact = false,
  sessionRef,
  usage,
}: {
  /** Narrow composer: the ring alone, with the readout left to the popover. */
  readonly compact?: boolean
  /** The session whose cost the popover totals; a draft has none. */
  readonly sessionRef?: ScopedSessionRef | null
  readonly usage: ContextUsage
}) {
  const percent = usage.ratio === null ? null : Math.round(usage.ratio * 100)

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={contextUsageLabel(usage, percent)}
                  className={cn(
                    'h-auto cursor-pointer gap-1.5 px-1 py-0.5 font-normal',
                    toneClass(usage.ratio),
                  )}
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <svg
                    aria-hidden
                    className='size-4 shrink-0 -rotate-90'
                    fill='none'
                    viewBox='0 0 18 18'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <circle
                      className='text-border'
                      cx='9'
                      cy='9'
                      r={RADIUS}
                      stroke='currentColor'
                      strokeWidth='2'
                    />
                    {usage.ratio === null ? null : (
                      <circle
                        cx='9'
                        cy='9'
                        r={RADIUS}
                        stroke='currentColor'
                        strokeDasharray={`${CIRCUMFERENCE * usage.ratio} ${CIRCUMFERENCE}`}
                        strokeLinecap='round'
                        strokeWidth='2'
                      />
                    )}
                  </svg>
                  {compact ? null : (
                    <span className='text-2xs tabular-nums'>
                      {usage.estimated ? '~' : ''}
                      {percent === null ? (
                        formatContextTokens(usage.usedTokens)
                      ) : (
                        <TickerNumber value={percent} />
                      )}
                      {percent === null ? null : '%'}
                    </span>
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent>{contextUsageLabel(usage, percent)}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-72 text-xs' side='top'>
        <ContextUsageDetails sessionRef={sessionRef ?? null} usage={usage} />
      </PopoverContent>
    </Popover>
  )
}

function contextUsageLabel(usage: ContextUsage, percent: number | null) {
  if (percent === null) {
    return `Context ${formatContextTokens(usage.usedTokens)} tokens used, window size unknown`
  }

  return `Context ${percent}% full`
}

function toneClass(ratio: number | null) {
  const tone = contextUsageTone(ratio)
  if (tone === 'destructive') return 'text-destructive'
  if (tone === 'warning') return 'text-warning'

  return 'text-muted-foreground'
}
