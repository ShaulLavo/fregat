import type { ModelPrice, ModelPrices } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useState } from 'react'

import { UsageDayChart } from '@/features/settings/components/usage-day-chart'
import { UsageLoading } from '@/features/settings/components/usage-loading'
import { UsageModelRow } from '@/features/settings/components/usage-model-row'
import { UsagePriceRow } from '@/features/settings/components/usage-price-row'
import { UsagePurposeRow } from '@/features/settings/components/usage-purpose-row'
import { UsageRangeTabs } from '@/features/settings/components/usage-range-tabs'
import { UsageSummary } from '@/features/settings/components/usage-summary'
import { useUsageHistory } from '@/features/settings/hooks/use-usage-history'
import { pricedModelNames, withModelPrice, type UsageDays } from '@/features/settings/utils/usage'

/**
 * The `usage.modelPrices` row. What it stores is the price list at the bottom; the
 * spend above it is read from the server, which records every turn the app runs.
 */
export function UsageSection({
  disabled,
  onChange,
  prices,
}: {
  readonly disabled: boolean
  readonly onChange: (next: ModelPrices) => void
  readonly prices: ModelPrices
}) {
  const [days, setDays] = useState<UsageDays>(30)
  const history = useUsageHistory(days)
  const models = pricedModelNames(history.data, prices)
  const setPrice = (model: string, price: ModelPrice | null) =>
    onChange(withModelPrice(prices, model, price))

  return (
    <div
      className='flex w-full min-w-0 flex-col gap-4 @3xl/settings:w-[min(36rem,50vw)]'
      data-usage-section
    >
      <UsageRangeTabs days={days} onSelect={setDays} />
      {history.isPending ? <UsageLoading /> : null}
      {history.isError ? (
        <EmptyState
          action={
            <Button onClick={() => void history.refetch()} size='sm' variant='outline'>
              Retry
            </Button>
          }
          align='start'
          title='Usage could not be loaded'
          tone='error'
        />
      ) : null}
      {history.data && history.data.totals.turns === 0 ? (
        <EmptyState
          align='start'
          description='Every chat turn, session title and commit message the app runs is recorded from now on.'
          title={`No usage in the last ${days} days`}
        />
      ) : null}
      {history.data && history.data.totals.turns > 0 ? (
        <>
          <UsageSummary history={history.data} />
          <UsageDayChart history={history.data} />
          <section aria-label='By model' className='flex flex-col gap-2'>
            <h3 className='text-muted-foreground text-2xs font-medium'>By model</h3>
            <ul className='flex flex-col gap-1.5'>
              {history.data.models.map((row) => (
                <UsageModelRow key={`${row.driverKind}:${row.model}`} row={row} />
              ))}
            </ul>
          </section>
          <section aria-label='By purpose' className='flex flex-col gap-2'>
            <h3 className='text-muted-foreground text-2xs font-medium'>By purpose</h3>
            <ul className='flex flex-col gap-1.5'>
              {history.data.purposes.map((row) => (
                <UsagePurposeRow key={row.purpose} row={row} />
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {models.length > 0 ? (
        <section aria-label='Prices' className='flex flex-col gap-2'>
          <h3 className='text-muted-foreground text-2xs font-medium'>Prices</h3>
          <p className='text-muted-foreground text-2xs'>
            Claude reports its own cost. These models report none, so their cost comes from the
            price you set, in US dollars per million tokens.
          </p>
          <ul className='flex flex-col gap-2'>
            {models.map((model) => (
              <UsagePriceRow
                disabled={disabled}
                key={model}
                model={model}
                onChange={(price) => setPrice(model, price)}
                price={prices[model]}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
