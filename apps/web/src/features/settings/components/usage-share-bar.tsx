import type { ProviderUsageModelRow } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

import { usageModelKey, usageModelMeasure } from '@/features/settings/utils/usage'
import { chartFill } from '@/lib/chart-fills'

/** Each shown model's share on one line. Hovering one dims the rest; nothing grows. */
export function UsageShareBar({
  byCost,
  hidden,
  hovered,
  models,
  onHover,
}: {
  readonly byCost: boolean
  readonly hidden: ReadonlySet<string>
  readonly hovered: string | null
  readonly models: readonly ProviderUsageModelRow[]
  readonly onHover: (key: string | null) => void
}) {
  const shown = models.filter((row) => !hidden.has(usageModelKey(row)))
  const total = shown.reduce((sum, row) => sum + usageModelMeasure(row, byCost), 0)
  if (total === 0) return null

  return (
    <div
      aria-label={byCost ? 'Cost by model' : 'Tokens by model'}
      className='bg-muted flex h-2 w-full overflow-hidden rounded-full'
      role='img'
      onMouseLeave={() => onHover(null)}
    >
      {models.map((row, index) => {
        const key = usageModelKey(row)
        const share = usageModelMeasure(row, byCost) / total
        if (hidden.has(key) || share === 0) return null

        return (
          <span
            className={cn(
              'h-full transition-opacity',
              chartFill(index),
              hovered !== null && hovered !== key && 'opacity-30',
            )}
            data-tooltip={`${row.model} · ${Math.round(share * 100)}%`}
            key={key}
            style={{ width: `${share * 100}%` }}
            onMouseEnter={() => onHover(key)}
          />
        )
      })}
    </div>
  )
}
