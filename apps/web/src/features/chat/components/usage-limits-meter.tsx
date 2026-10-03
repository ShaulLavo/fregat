import { GaugeIcon } from '@phosphor-icons/react'
import type { ProviderAccountUsage } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { ProviderAccountUsageDetails } from '@/components/provider-account-usage-details'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useCoarseNow } from '@/hooks/use-coarse-now'
import { usageAccountLabel } from '@/lib/provider-usage'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { composerUsageReadout } from '@/features/chat/utils/usage-meter'
import { ResetCreditAction } from './reset-credit-action'

/** A source-mapped group keeps rotating accounts independent and selection explicit. */
export function UsageLimitsMeter({
  accounts,
  receivedAtMs = 0,
  compact = false,
}: {
  readonly accounts: readonly ProviderAccountUsage[]
  readonly receivedAtMs?: number
  readonly compact?: boolean
}) {
  // A query receipt can be newer than the shared minute sample, without changing source timestamps.
  const nowMs = Math.max(useCoarseNow(), receivedAtMs)
  const staleAfterMs = useSettingValue('providers.usageStaleAfterSeconds') * 1000
  const bus = useCommandBus()
  const [open, setOpen] = useState(false)
  const readout = composerUsageReadout(accounts, nowMs, staleAfterMs)
  const label = `Account allowances · ${readout}`
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
                    'cursor-pointer font-normal',
                    !compact && 'h-auto gap-1 px-1 py-0.5',
                  )}
                  data-usage-meter
                  size={compact ? 'icon-sm' : 'sm'}
                  type='button'
                  variant='ghost'
                >
                  <GaugeIcon
                    aria-hidden
                    className={compact ? 'size-(--icon-size-sm)' : 'size-(--icon-size)'}
                  />
                  {compact ? null : (
                    <span className='text-2xs font-mono tabular-nums'>{readout}</span>
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align='end'
        className='scroll-fade scroll-gutter flex max-h-[70vh] w-72 flex-col gap-2 overflow-y-auto overscroll-contain text-xs'
        data-usage-popover
        side='top'
      >
        <p className='text-xs font-medium'>Account allowances</p>
        {accounts.length === 0 ? (
          <p className='text-muted-foreground text-2xs'>
            Account mapping unavailable. Selection unknown.
          </p>
        ) : null}
        {accounts.length > 1 ? (
          <p className='text-muted-foreground text-2xs'>
            Configured usage-source group. Allowances apply independently.
          </p>
        ) : null}
        {accounts.map((account, index) => (
          <div className='flex flex-col gap-1' key={account.accountKey}>
            <ProviderAccountUsageDetails
              account={account}
              label={usageAccountLabel(account, index)}
              nowMs={nowMs}
            />
            <ResetCreditAction account={account} />
          </div>
        ))}
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
      </PopoverContent>
    </Popover>
  )
}
