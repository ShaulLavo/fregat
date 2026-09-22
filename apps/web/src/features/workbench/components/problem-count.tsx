import { TickerNumber } from '@/components/ticker-number'

import { useMarkerTotal } from '@/hooks/use-markers'

export function ProblemCount() {
  const count = useMarkerTotal()

  return (
    <span className='bg-muted text-muted-foreground text-3xs flex h-4 min-w-4 items-center justify-center rounded-full px-1 tabular-nums'>
      <TickerNumber size='3xs' value={count} />
    </span>
  )
}
