import { TickerNumber } from '@/components/ticker-number'
import { digitRuns } from '@/components/utils/digit-runs'
import type { TickerSize } from '@/components/utils/ticker-size'

/**
 * A formatted string whose numbers roll while the rest stays put: `1m 20s`
 * ticks the seconds without redrawing the `m` and `s`, and `↑2 ↓1` keeps its
 * arrows.
 */
export function TickerText({ size, text }: { size?: TickerSize; text: string }) {
  return (
    <span aria-label={text} className='inline-flex items-center' role='img'>
      {digitRuns(text).map((run, index) =>
        run.digits ? (
          <TickerNumber key={index} size={size} value={Number(run.text)} />
        ) : (
          <span className='whitespace-pre' key={index}>
            {run.text}
          </span>
        ),
      )}
    </span>
  )
}
