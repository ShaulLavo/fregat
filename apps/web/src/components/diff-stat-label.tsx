import { TickerNumber } from '@/components/ticker-number'
import { formatCompactDiffCount } from '@/components/utils/compact-diff-count'
import type { TickerSize } from '@/components/utils/ticker-size'

const TICKER_LIMIT = 1_000

export function DiffStatLabel({
  additions,
  deletions,
  showParentheses = false,
  size,
}: {
  additions: number
  deletions: number
  size?: TickerSize
  showParentheses?: boolean
}) {
  return (
    <>
      {showParentheses ? <span className='text-muted-foreground'>(</span> : null}
      {/* The compact digits are decoration; the exact counts live in the name. */}
      <span
        aria-label={`${additions} additions, ${deletions} deletions`}
        className='inline-flex items-center'
        role='group'
      >
        <span aria-hidden='true' className='text-diff-added inline-flex tabular-nums'>
          +{count(additions, size)}
        </span>
        <span aria-hidden='true' className='text-muted-foreground mx-0.5'>
          /
        </span>
        <span aria-hidden='true' className='text-diff-removed inline-flex tabular-nums'>
          -{count(deletions, size)}
        </span>
      </span>
      {showParentheses ? <span className='text-muted-foreground'>)</span> : null}
    </>
  )
}

// A compacted count ("1.5k") carries a suffix the ticker cannot roll.
function count(value: number, size: TickerSize | undefined) {
  if (value >= TICKER_LIMIT) return formatCompactDiffCount(value)

  return <TickerNumber size={size} value={value} />
}
