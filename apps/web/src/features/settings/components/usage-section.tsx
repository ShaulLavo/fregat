import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useState } from 'react'

import { Spinner } from '@workspace/ui/components/spinner'
import { AccountAllowances } from '@/features/settings/components/account-allowances'
import { TranscriptCoverage } from '@/features/settings/components/transcript-coverage'
import { UsageDayChart } from '@/features/settings/components/usage-day-chart'
import { UsageLoading } from '@/features/settings/components/usage-loading'
import { UsageModelList } from '@/features/settings/components/usage-model-list'
import { UsagePurposeRow } from '@/features/settings/components/usage-purpose-row'
import { UsageRangeTabs } from '@/features/settings/components/usage-range-tabs'
import { UsageShareBar } from '@/features/settings/components/usage-share-bar'
import { UsageSummary } from '@/features/settings/components/usage-summary'
import { useUsageHistory } from '@/features/settings/hooks/use-usage-history'
import { hiddenUsageModels, type UsageDays } from '@/features/settings/utils/usage'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'

export function UsageSection() {
  const [days, setDays] = useState<UsageDays>(30)
  const [hiddenKeys, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const history = useUsageHistory(days)
  const receivedAtMs = useHeldUntilReady(history.dataUpdatedAt, !history.isPlaceholderData)
  const models = history.data?.models ?? []
  const hidden = hiddenUsageModels(models, hiddenKeys)
  const byCost = (history.data?.totals.costUsd ?? 0) > 0

  // The last shown model stays: an empty chart would read as a range with no usage.
  function toggleModel(key: string) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else if (models.length - next.size > 1) next.add(key)
    setHidden(next)
  }

  function selectRange(next: UsageDays) {
    setDays(next)
    setHidden(new Set())
    setHovered(null)
  }

  return (
    <div
      className='flex w-full min-w-0 flex-col gap-4 @3xl/settings:w-[min(36rem,50vw)]'
      data-usage-section
    >
      <AccountAllowances />
      <section aria-label='Local transcript history' className='flex min-w-0 flex-col gap-4'>
        <div className='flex items-center gap-2'>
          <h3 className='text-sm font-semibold'>Local transcript history</h3>
          {history.isPlaceholderData ? <Spinner size='sm' /> : null}
        </div>
        <p className='text-muted-foreground text-xs'>
          Estimated API-equivalent value of the covered local tokens. Subscription charges appear in
          your provider’s billing statement.
        </p>
        <UsageRangeTabs days={history.data?.days ?? days} onSelect={selectRange} />
        {history.data ? (
          <TranscriptCoverage coverage={history.data.coverage} receivedAtMs={receivedAtMs} />
        ) : null}
        {history.isPending ? <UsageLoading /> : null}
        {!history.isPending && history.isError ? (
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
            description='Covered transcript stores and recorded Fregat activity have no usage in this range.'
            title={`No usage in the last ${history.data.days} days`}
          />
        ) : null}
        {history.data && history.data.totals.turns > 0 ? (
          <>
            <UsageSummary history={history.data} />
            <UsageDayChart byCost={byCost} hidden={hidden} history={history.data} />
            <section aria-label='By model' className='flex flex-col gap-2'>
              <h3 className='text-muted-foreground text-2xs font-medium'>By model</h3>
              <UsageShareBar
                byCost={byCost}
                hidden={hidden}
                hovered={hovered}
                models={models}
                onHover={setHovered}
              />
              <UsageModelList
                byCost={byCost}
                hidden={hidden}
                models={models}
                onHover={setHovered}
                onToggle={toggleModel}
              />
            </section>
            <section aria-label='By purpose' className='flex flex-col gap-2'>
              <h3 className='text-muted-foreground text-2xs font-medium'>By purpose</h3>
              <ul className='flex flex-col gap-1.5'>
                {history.data.purposes.map((row) => (
                  <UsagePurposeRow key={row.purpose} row={row} />
                ))}
              </ul>
            </section>
            <p className='text-muted-foreground text-2xs'>
              Totals describe the covered local sources and their recorded price provenance.
            </p>
          </>
        ) : null}
      </section>
    </div>
  )
}
