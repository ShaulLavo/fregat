import { AnimatedCounter } from 'react-animated-counter'

import { TICKER_FONT_SIZES, type TickerSize } from '@/components/utils/ticker-size'

const CONTAINER_STYLES = {
  display: 'inline-flex',
  margin: 0,
} as const

const DIGIT_STYLES = {
  fontVariantNumeric: 'tabular-nums',
} as const

/**
 * A number that rolls its digits when it changes. Use it where a value updates
 * under a stable element; a number that only ever arrives with its row is not
 * a ticker.
 *
 * Each column stacks all ten digits, so `role='img'` is what stops a screen
 * reader from reading "9876543210" once per digit. That also means the digits
 * are not text: assert on the label, not on `textContent`.
 *
 * The counter renders on its own to run the roll, so keep it out of a subtree
 * that must not re-render — the session rail during streaming is the one this
 * rule comes from.
 *
 * The digits are an unshrinkable inline-flex box: they neither compress nor
 * ellipsize. Inside a `min-w-0` flex item they will overflow it and paint over
 * whatever follows, so that ancestor needs to either clip or wrap.
 */
export function TickerNumber({
  size = '2xs',
  value,
}: {
  /** Must match the type step of the surrounding text: the digits cannot inherit it. */
  size?: TickerSize
  value: number
}) {
  return (
    <span aria-label={value.toLocaleString()} role='img'>
      <AnimatedCounter
        color='currentColor'
        containerStyles={CONTAINER_STYLES}
        decrementColor='currentColor'
        digitStyles={DIGIT_STYLES}
        fontSize={TICKER_FONT_SIZES[size]}
        includeCommas
        includeDecimals={false}
        incrementColor='currentColor'
        value={value}
      />
    </span>
  )
}
