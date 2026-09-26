import { TickerNumber } from '@/components/ticker-number'
import { formatUsd } from '@/lib/usd'

/** A cost that rolls as the session spends; under a cent it keeps its digits instead. */
export function SessionCost({ costUsd }: { readonly costUsd: number | null }) {
  if (costUsd === null) return 'No price'
  if (costUsd < 0.01) return formatUsd(costUsd)

  return (
    <>
      $<TickerNumber decimals={2} value={costUsd} />
    </>
  )
}
