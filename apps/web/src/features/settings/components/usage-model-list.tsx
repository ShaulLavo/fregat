import { usageTokenCount, type ProviderUsageModelRow } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { UsageModelRow } from '@/features/settings/components/usage-model-row'
import {
  formatModelCost,
  USAGE_MODEL_ROWS_SHOWN,
  usageModelKey,
  usageModelMeasure,
} from '@/features/settings/utils/usage'

/** The top models, the rest folded into one row that opens in place, and a totals row. */
export function UsageModelList({
  byCost,
  hidden,
  models,
  onHover,
  onToggle,
}: {
  readonly byCost: boolean
  readonly hidden: ReadonlySet<string>
  readonly models: readonly ProviderUsageModelRow[]
  readonly onHover: (key: string | null) => void
  readonly onToggle: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? models : models.slice(0, USAGE_MODEL_ROWS_SHOWN)
  const folded = models.slice(shown.length)
  const peak = Math.max(...models.map((row) => usageModelMeasure(row, byCost)), 0)
  const cost = (rows: readonly ProviderUsageModelRow[]) =>
    formatModelCost({
      costUsd: rows.some((row) => row.costUsd !== null)
        ? rows.reduce((total, row) => total + (row.costUsd ?? 0), 0)
        : null,
    })

  return (
    <div className='flex flex-col'>
      {shown.map((row, index) => {
        const key = usageModelKey(row)
        return (
          <UsageModelRow
            colorIndex={index}
            key={key}
            onHover={(hovering) => onHover(hovering ? key : null)}
            onToggle={() => onToggle(key)}
            row={row}
            share={peak > 0 ? usageModelMeasure(row, byCost) / peak : 0}
            shown={!hidden.has(key)}
          />
        )
      })}
      {folded.length > 0 ? (
        <Button
          className='text-muted-foreground justify-start text-xs font-normal'
          size='sm'
          type='button'
          variant='ghost'
          onClick={() => setExpanded(true)}
        >
          {folded.length} more · {cost(folded)}
        </Button>
      ) : null}
      <div className='text-muted-foreground flex items-baseline gap-3 px-(--density-row-padding-x) pt-1 text-xs'>
        <span className='min-w-0 flex-1'>Total</span>
        <span className='shrink-0 tabular-nums'>
          {formatContextTokens(models.reduce((total, row) => total + usageTokenCount(row), 0))}{' '}
          tokens
        </span>
        <span className='min-w-16 shrink-0 text-right tabular-nums'>{cost(models)}</span>
      </div>
    </div>
  )
}
