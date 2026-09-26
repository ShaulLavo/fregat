export const TICKER_SIZE_CLASSES = {
  sm: 'text-sm',
  xs: 'text-xs',
  '2xs': 'text-2xs',
  '3xs': 'text-3xs',
} as const

export type TickerSize = keyof typeof TICKER_SIZE_CLASSES
