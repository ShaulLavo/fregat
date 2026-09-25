import { usageTokenCount, type ProviderUsageModelRow } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { cn } from '@workspace/ui/lib/utils'

import { formatModelCost } from '@/features/settings/utils/usage'

export function UsageModelRow({ row }: { readonly row: ProviderUsageModelRow }) {
  const detail = `${row.model} (${row.driverKind}) · ${formatContextTokens(row.inputTokens)} in, ${formatContextTokens(row.outputTokens)} out, ${formatContextTokens(row.cacheReadTokens)} cache read, ${formatContextTokens(row.cacheWriteTokens)} cache write`

  return (
    <li className='flex items-baseline gap-3 text-xs' data-usage-model={row.model} title={detail}>
      <span className='min-w-0 flex-1 truncate'>{row.model}</span>
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
    </li>
  )
}
