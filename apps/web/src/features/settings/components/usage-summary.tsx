import type { ProviderUsageHistory } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'

import { formatModelCost } from '@/features/settings/utils/usage'

/** The headline, and how much usage it leaves out, so a total is never silently low. */
export function UsageSummary({ history }: { readonly history: ProviderUsageHistory }) {
  const { totals } = history

  return (
    <div className='flex flex-col gap-1' data-usage-summary>
      <p className='text-muted-foreground text-xs'>Estimated cost</p>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <span className='text-sm font-semibold tabular-nums'>{formatModelCost(totals)}</span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {formatContextTokens(totals.tokens)} tokens · {totals.turns}{' '}
          {totals.turns === 1 ? 'turn' : 'turns'}
        </span>
      </div>
      <p className='text-muted-foreground text-2xs'>
        Claude's own estimate, or standard API rates for models Platform prices.
      </p>
      {totals.unpricedTokens > 0 ? (
        <p className='text-muted-foreground text-2xs tabular-nums'>
          Excludes {formatContextTokens(totals.unpricedTokens)} tokens from models without a price.
        </p>
      ) : null}
    </div>
  )
}
