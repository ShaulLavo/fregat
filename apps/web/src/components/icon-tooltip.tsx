import { Kbd } from '@workspace/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { ReactElement } from 'react'

import { formatChord } from '@/keymap/utils/format-keys'

export function IconTooltip({
  children,
  label,
  shortcut,
}: {
  children: ReactElement
  label: string
  /** A chord in keymap notation, such as `Mod+ArrowUp`. */
  shortcut?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        {shortcut ? <Kbd>{formatChord(shortcut)}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
