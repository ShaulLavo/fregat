import { cn } from '@workspace/ui/lib/utils'

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'

type SpinnerProps = {
  readonly size?: SpinnerSize
  readonly label?: string
  readonly className?: string
  readonly role?: 'status' | 'presentation'
  readonly 'aria-hidden'?: boolean | 'true' | 'false'
  readonly 'data-icon'?: string
}

/**
 * Three bands that overlap by a quarter unit, so neighbours are told apart by
 * colour rather than by air — the only thing that survives a 12px render. Dash
 * pairs are whole fractions of each circumference, so no ring shows a seam.
 */
const SPINNER_BANDS = [
  { dash: '7.78 6.36', radius: 6.75 },
  { dash: '7.78 6.36', radius: 4.5 },
  { dash: '8.48 5.65', radius: 2.25 },
] as const

const RING_SIZE_CLASS: Record<Exclude<SpinnerSize, 'lg'>, string> = {
  xs: 'size-(--icon-size-sm)',
  sm: 'size-(--icon-size)',
  md: 'size-6',
}

/**
 * The app's one busy mark. xs–md draw overlapping bands; lg draws four thin
 * conic rings for a whole-surface wait. Both take their colours from the
 * theme's primary, so a call site never sets a colour.
 *
 * With no `size`, the bands are a bare svg a control can size: Button and
 * InputGroup carry `[&_svg:not([class*='size-'])]`, so a spinner in a small
 * button lands where the icon it replaced did.
 */
function Spinner({ size, label = 'Loading', className, ...props }: SpinnerProps) {
  if (size === 'lg')
    return (
      <div
        aria-label={label}
        className={cn('spinner-rings relative size-10', className)}
        data-slot='spinner'
        role='status'
        {...props}
      >
        <span aria-hidden='true' className='spinner-ring-1' />
        <span aria-hidden='true' className='spinner-ring-2' />
        <span aria-hidden='true' className='spinner-ring-3' />
        <span aria-hidden='true' className='spinner-ring-4' />
      </div>
    )

  return (
    <svg
      aria-label={label}
      className={cn('spinner-bands', size && RING_SIZE_CLASS[size], className)}
      data-slot='spinner'
      fill='none'
      role='status'
      viewBox='0 0 16 16'
      {...props}
    >
      {SPINNER_BANDS.map((band) => (
        <circle
          cx='8'
          cy='8'
          key={band.radius}
          r={band.radius}
          strokeDasharray={band.dash}
          strokeWidth='2.5'
        />
      ))}
    </svg>
  )
}

export { Spinner }
