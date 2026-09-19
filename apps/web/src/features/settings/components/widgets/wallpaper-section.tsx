import type { ReactNode } from 'react'

export function WallpaperSection({
  heading,
  count,
  children,
}: {
  readonly heading: string
  readonly count?: number
  readonly children: ReactNode
}) {
  return (
    <section aria-label={heading} className='flex flex-col gap-2'>
      <h3 className='flex items-baseline gap-2 text-xs font-medium'>
        {heading}
        {count === undefined ? null : (
          <span className='text-muted-foreground text-2xs tabular-nums'>{count}</span>
        )}
      </h3>
      <div className='grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2'>{children}</div>
    </section>
  )
}
