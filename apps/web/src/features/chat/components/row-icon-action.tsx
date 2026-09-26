import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

/** An icon control at the end of a list row; a spinner stands in while its action runs. */
export function RowIconAction({
  busy,
  children,
  label,
  onClick,
}: {
  readonly busy: boolean
  readonly children: ReactNode
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={busy}
            focusableWhenDisabled
            size='icon-xs'
            type='button'
            variant='ghost'
            onClick={onClick}
          >
            {busy ? <Spinner /> : children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
