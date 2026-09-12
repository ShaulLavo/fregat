import { Button } from '@workspace/ui/components/button'
import type { MouseEvent, ReactNode } from 'react'

export function RowActionButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
}) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    onClick()
  }

  return (
    <Button
      aria-label={label}
      className='text-muted-foreground hover:text-foreground'
      disabled={disabled}
      onClick={handleClick}
      size='icon-xs'
      title={label}
      type='button'
      variant='ghost'
    >
      {children}
    </Button>
  )
}
