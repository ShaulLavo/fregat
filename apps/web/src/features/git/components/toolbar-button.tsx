import { Button } from '@workspace/ui/components/button'
import type { ReactNode } from 'react'

export function ToolbarButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
}) {
  return (
    <Button
      aria-label={label}
      className='text-muted-foreground hover:text-foreground relative'
      disabled={disabled}
      onClick={onClick}
      size='icon-xs'
      title={label}
      type='button'
      variant='ghost'
    >
      {children}
    </Button>
  )
}
