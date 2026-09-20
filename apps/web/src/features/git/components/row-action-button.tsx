import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className='text-muted-foreground'
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
        }
      />
      <TooltipContent side='bottom'>{label}</TooltipContent>
    </Tooltip>
  )
}
