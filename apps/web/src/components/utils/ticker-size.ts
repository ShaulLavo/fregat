/**
 * The ticker sets `font-size` on its digit spans, so it cannot inherit the
 * surrounding `text-*` class. These are the four type steps in pixels; a call
 * site names its step rather than picking a size.
 */
export const TICKER_FONT_SIZES = {
  sm: '14px',
  xs: '12px',
  '2xs': '11px',
  '3xs': '10px',
} as const

export type TickerSize = keyof typeof TICKER_FONT_SIZES
