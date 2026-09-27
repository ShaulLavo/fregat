import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

export function WallpaperSection({
  heading,
  count,
  strip = false,
  children,
}: {
  readonly heading: string
  readonly count?: number
  /** One row that scrolls sideways, so the section's height stays one card high. */
  readonly strip?: boolean
  readonly children: ReactNode
}) {
  return (
    <section aria-label={heading} className='flex flex-col gap-2'>
      <h3 className='flex items-baseline gap-2 text-xs font-medium'>
        {heading}
        {count === undefined ? null : (
          <span className='text-muted-foreground text-2xs font-mono tabular-nums'>{count}</span>
        )}
      </h3>
      <div
        className={cn(
          'gap-2',
          strip
            ? 'no-scrollbar flex overflow-x-auto *:w-40 *:shrink-0'
            : 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
        )}
      >
        {children}
      </div>
    </section>
  )
}
