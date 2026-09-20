import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { ReactElement } from 'react'

export function IconTooltip({ children, label }: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
