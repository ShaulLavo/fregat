import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useState } from 'react'

import { UsageDayChart } from '@/features/settings/components/usage-day-chart'
import { UsageLoading } from '@/features/settings/components/usage-loading'
import { UsageModelList } from '@/features/settings/components/usage-model-list'
import { UsagePurposeRow } from '@/features/settings/components/usage-purpose-row'
import { UsageRangeTabs } from '@/features/settings/components/usage-range-tabs'
import { UsageShareBar } from '@/features/settings/components/usage-share-bar'
import { UsageSummary } from '@/features/settings/components/usage-summary'
import { useUsageHistory } from '@/features/settings/hooks/use-usage-history'
import { hiddenUsageModels, type UsageDays } from '@/features/settings/utils/usage'

export function UsageSection() {
  const [days, setDays] = useState<UsageDays>(30)
  const [hiddenKeys, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const history = useUsageHistory(days)
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
      <UsageRangeTabs days={days} onSelect={selectRange} />
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
            A turn counts when it ends. A child agent's usage lands with its parent's next turn.
          </p>
        </>
      ) : null}
    </div>
  )
}
