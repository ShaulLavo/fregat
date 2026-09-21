import { useId } from 'react'

import { Tooltip, TooltipContent } from '@workspace/ui/components/tooltip'
import { useTooltipLayer } from '@workspace/ui/patterns/use-tooltip-layer'

/**
 * The app's one hover tooltip. Mount it once; anything with `data-tooltip`
 * gets it, including rows a virtualizer recycles.
 *
 * This replaces the native `title` on rows: a browser tooltip cannot be themed
 * or delayed to match, and it applies to every descendant, so a control with
 * its own tooltip inside a titled row drew two.
 */
export function TooltipLayer() {
  const id = useId()
  const target = useTooltipLayer(id)

  return (
    <Tooltip open={target !== null}>
      <TooltipContent anchor={target?.element ?? null} id={id} side='bottom'>
        {target?.text}
      </TooltipContent>
    </Tooltip>
  )
}
