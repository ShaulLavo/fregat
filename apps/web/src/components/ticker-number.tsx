import { Ticker } from '@workspace/ui/components/ticker'
import { TICKER_SIZE_CLASSES, type TickerSize } from '@/components/utils/ticker-size'

export function TickerNumber({
  decimals = 0,
  size = '2xs',
  value,
}: {
  decimals?: number
  size?: TickerSize
  value: number
}) {
  return (
    <span className={TICKER_SIZE_CLASSES[size]}>
      <Ticker value={value} decimals={decimals} />
    </span>
  )
}
