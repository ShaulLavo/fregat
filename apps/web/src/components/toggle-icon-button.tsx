import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
export function ToggleIconButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className={cn('text-muted-foreground', active && 'bg-accent text-accent-foreground')}
      size='icon-sm'
      title={label}
      type='button'
      variant='ghost'
      onClick={onClick}
    >
      {icon}
    </Button>
  )
}
