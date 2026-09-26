import { usageTokenCount, type ProviderUsageModelRow } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { cn } from '@workspace/ui/lib/utils'

import { formatModelCost, usageCostArithmetic } from '@/features/settings/utils/usage'
import { chartFill } from '@/lib/chart-fills'

/**
 * One model: its tokens, cost and share, with the arithmetic in the title. Pressing it
 * takes the model out of the share bar and the day chart.
 */
export function UsageModelRow({
  colorIndex,
  onHover,
  onToggle,
  row,
  share,
  shown,
}: {
  readonly colorIndex: number
  readonly onHover: (hovering: boolean) => void
  readonly onToggle: () => void
  /** This row's part of the largest row's measure, for the data bar. */
  readonly share: number
  readonly row: ProviderUsageModelRow
  readonly shown: boolean
}) {
  return (
    <ListRow
      aria-pressed={shown}
      as='button'
      className={cn(
        'h-auto flex-col items-stretch gap-0.5 py-(--density-row-padding-y) text-xs',
        !shown && 'text-muted-foreground',
      )}
      data-usage-model={row.model}
      title={`${row.model} (${row.driverKind}) · ${usageCostArithmetic(row)}`}
      type='button'
      onClick={onToggle}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className='flex min-w-0 items-baseline gap-3'>
        <span
          className={cn(
            'size-2 shrink-0 self-center rounded-full',
            shown ? chartFill(colorIndex) : 'bg-muted',
          )}
        />
        <span className='min-w-0 flex-1 truncate text-left'>{row.model}</span>
        <span className='text-muted-foreground shrink-0 tabular-nums'>
          {formatContextTokens(usageTokenCount(row))} tokens
        </span>
        <span
          className={cn(
            'min-w-16 shrink-0 text-right tabular-nums',
            row.costSource === 'none' && 'text-muted-foreground',
          )}
        >
          {formatModelCost(row)}
        </span>
      </span>
      <span
        aria-hidden='true'
        className='bg-muted-foreground h-0.5 rounded-full'
        style={{ width: `${Math.max(share * 100, 1)}%` }}
      />
    </ListRow>
  )
}
