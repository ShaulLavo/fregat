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
 * kokonutui's AI loader in a 16-unit box: its radii and its 31% dash duty. Dash
 * counts are rounded to whole numbers per ring so no ring shows a seam. Stroke
 * width lives in CSS, because it changes with size.
 */
const SPINNER_BANDS = [
  { dash: '2.86 6.36', radius: 7.333 },
  { dash: '2.92 6.5', radius: 6 },
  { dash: '3.03 6.74', radius: 4.667 },
  { dash: '3.25 7.22', radius: 3.333 },
] as const

const RING_SIZE_CLASS: Record<Exclude<SpinnerSize, 'lg'>, string> = {
  xs: 'size-(--icon-size-sm)',
  sm: 'size-(--icon-size)',
  md: 'size-6',
}

/**
 * The app's one busy mark. xs–md draw four dashed rings; lg draws four thin
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
      data-size={size}
      data-slot='spinner'
      fill='none'
      role='status'
      viewBox='0 0 16 16'
      {...props}
    >
      {SPINNER_BANDS.map((band) => (
        <circle cx='8' cy='8' key={band.radius} r={band.radius} strokeDasharray={band.dash} />
      ))}
    </svg>
  )
}

export { Spinner }
export type { SpinnerSize }
