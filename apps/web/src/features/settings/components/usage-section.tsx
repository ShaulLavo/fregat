import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useState } from 'react'

import { UsageDayChart } from '@/features/settings/components/usage-day-chart'
import { UsageLoading } from '@/features/settings/components/usage-loading'
import { UsageModelRow } from '@/features/settings/components/usage-model-row'
import { UsagePurposeRow } from '@/features/settings/components/usage-purpose-row'
import { UsageRangeTabs } from '@/features/settings/components/usage-range-tabs'
import { UsageSummary } from '@/features/settings/components/usage-summary'
import { useUsageHistory } from '@/features/settings/hooks/use-usage-history'
import type { UsageDays } from '@/features/settings/utils/usage'

export function UsageSection() {
  const [days, setDays] = useState<UsageDays>(30)
  const history = useUsageHistory(days)
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
    </div>
  )
}
