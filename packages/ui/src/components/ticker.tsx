import { TickerDigit } from './ticker-digit'

export function Ticker({
  value,
  decimals = 0,
}: {
  readonly value: number
  readonly decimals?: number
}) {
  const text = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (
    <span aria-label={text} role='img' className='inline-flex font-mono tabular-nums'>
      <span aria-hidden className='inline-flex'>
        {Array.from(text).map((character, index) =>
          /[0-9]/.test(character) ? (
            <TickerDigit key={text.length - index} value={Number(character)} />
          ) : (
            <span key={text.length - index}>{character}</span>
          ),
        )}
      </span>
    </span>
  )
}
