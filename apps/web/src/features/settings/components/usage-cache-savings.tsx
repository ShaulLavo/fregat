import { formatUsd } from '@/lib/usd'

export function UsageCacheSavings({ costUsd }: { readonly costUsd: number | null }) {
  return (
    <>
      Cache savings{' '}
      {costUsd === null ? (
        'unavailable'
      ) : (
        <span className='font-mono tabular-nums'>{formatUsd(costUsd)}</span>
      )}
    </>
  )
}
