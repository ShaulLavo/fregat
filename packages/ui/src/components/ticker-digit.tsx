const DIGITS = Array.from({ length: 10 }, (_, index) => index)

export function TickerDigit({ value }: { readonly value: number }) {
  return (
    <span className='inline-block h-[1em] overflow-hidden align-baseline leading-none'>
      <span
        data-slot='ticker-digit'
        className='inline-flex flex-col'
        style={{ transform: `translateY(-${value * 10}%)` }}
      >
        {DIGITS.map((digit) => (
          <span key={digit} className='h-[1em]'>
            {digit}
          </span>
        ))}
      </span>
    </span>
  )
}
