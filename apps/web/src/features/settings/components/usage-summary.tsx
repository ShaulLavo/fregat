import type { ProviderUsageHistory } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'

import { formatModelCost, usageCacheSavingsTotal } from '@/features/settings/utils/usage'
import { UsageCacheSavings } from '@/features/settings/components/usage-cache-savings'

/** The headline, and how much usage it leaves out, so a total is never silently low. */
export function UsageSummary({ history }: { readonly history: ProviderUsageHistory }) {
  const { totals } = history
  const savings = usageCacheSavingsTotal(history.models)

  return (
    <div className='flex flex-col gap-1' data-usage-summary>
      <p className='text-muted-foreground text-xs'>API-equivalent cost estimate</p>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <span className='text-sm font-semibold tabular-nums'>{formatModelCost(totals)}</span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {formatContextTokens(totals.tokens)} tokens · {totals.turns}{' '}
          {totals.turns === 1 ? 'turn' : 'turns'}
        </span>
      </div>
      <p className='text-muted-foreground text-2xs'>
        Provider-reported estimates or recorded standard API rates for covered local transcripts.
      </p>
      <p className='text-xs'>
        <UsageCacheSavings costUsd={savings.costUsd} />
      </p>
      <p className='text-muted-foreground text-2xs'>
        Savings compare recorded full-input and cache-read prices.
      </p>
      {savings.excludedCachedTokens > 0 ? (
        <p className='text-muted-foreground text-2xs'>
          Excludes{' '}
          <span className='font-mono tabular-nums'>
            {formatContextTokens(savings.excludedCachedTokens)}
          </span>{' '}
          cached tokens with unavailable or varying recorded prices.
        </p>
      ) : null}
      {totals.unpricedTokens > 0 ? (
        <p className='text-muted-foreground text-2xs tabular-nums'>
          Excludes {formatContextTokens(totals.unpricedTokens)} tokens from models without a price.
        </p>
      ) : null}
    </div>
  )
}
