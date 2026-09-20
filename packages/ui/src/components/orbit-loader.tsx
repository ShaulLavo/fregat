import type { ComponentProps } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * Three rings, each cut into two arcs at 55% duty — the dash pairs are that
 * fraction of each circumference, so every ring keeps the same rhythm however
 * far out it sits. Radii and stroke are set so the gaps survive a 16px render:
 * 1 unit of stroke to 1 unit of air, which is a whole pixel of each at 1x.
 */
const ORBIT_RINGS = [
  { dash: '11.23 9.19', opacity: 1, radius: 6.5 },
  { dash: '7.78 6.36', opacity: 0.85, radius: 4.5 },
  { dash: '4.32 3.53', opacity: 0.7, radius: 2.5 },
] as const

/**
 * The app's busy mark: a control mid-action, or a process running with no known
 * end. Three dashed rings counter-rotating at unrelated speeds, so the mark
 * never settles into looking like one rigid object.
 *
 * Defaults to --icon-size so it lands where an icon would in a control, and
 * follows density with one. Draws in currentColor.
 *
 * A region with no content yet gets LoadingState instead, and RingLoader is the
 * quieter sibling for a whole-surface wait.
 */
function OrbitLoader({
  className,
  label = 'Working',
  ...props
}: ComponentProps<'span'> & { label?: string }) {
  return (
    <span
      aria-label={label}
      className={cn('inline-block size-(--icon-size)', className)}
      data-slot='orbit-loader'
      role='status'
      {...props}
    >
      <svg aria-hidden='true' className='loader-orbit size-full' fill='none' viewBox='0 0 16 16'>
        {ORBIT_RINGS.map((ring) => (
          <circle
            cx='8'
            cy='8'
            key={ring.radius}
            opacity={ring.opacity}
            r={ring.radius}
            stroke='currentColor'
            strokeDasharray={ring.dash}
            strokeLinecap='round'
            strokeWidth='1'
          />
        ))}
      </svg>
    </span>
  )
}

export { OrbitLoader }
