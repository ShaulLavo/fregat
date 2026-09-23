import { Button } from '@workspace/ui/components/button'
import type { MouseEvent, ReactNode } from 'react'

// The shared tooltip layer reads `data-tooltip`: a Tooltip root per button per recycled row made scrolling slow.
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
      className='text-muted-foreground'
      data-tooltip={label}
      disabled={disabled}
      focusableWhenDisabled
      onClick={handleClick}
      size='icon-sm'
      tabIndex={-1}
      type='button'
      variant='ghost'
    >
      {children}
    </Button>
  )
}
