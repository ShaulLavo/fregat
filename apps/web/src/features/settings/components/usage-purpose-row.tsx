import type { ProviderUsagePurposeRow } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'

import { formatUsd, usagePurposeLabel } from '@/features/settings/utils/usage'

export function UsagePurposeRow({ row }: { readonly row: ProviderUsagePurposeRow }) {
  return (
    <li className='flex items-baseline gap-3 text-xs' data-usage-purpose={row.purpose}>
      <span className='min-w-0 flex-1'>{usagePurposeLabel(row.purpose)}</span>
      <span className='text-muted-foreground shrink-0 tabular-nums'>
        {row.turns} {row.turns === 1 ? 'turn' : 'turns'} · {formatContextTokens(row.tokens)} tokens
      </span>
      <span className='w-16 shrink-0 text-right tabular-nums'>{formatUsd(row.costUsd)}</span>
    </li>
  )
}
