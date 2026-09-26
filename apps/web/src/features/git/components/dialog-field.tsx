import type { ReactNode } from 'react'

/** A labelled control in a form dialog. */
export function DialogField({
  id,
  label,
  children,
}: {
  readonly id: string
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className='flex flex-col gap-1'>
      <label className='text-muted-foreground text-2xs font-medium' htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}
