import type { ReactNode } from 'react'

export function Section({
  title,
  detail,
  children,
}: {
  readonly title: string
  readonly detail: string
  readonly children: ReactNode
}) {
  return (
    <section className='flex flex-col gap-(--density-control-gap)'>
      <div>
        <h2 className='text-sm font-semibold'>{title}</h2>
        <p className='text-muted-foreground text-xs'>{detail}</p>
      </div>
      {children}
    </section>
  )
}
