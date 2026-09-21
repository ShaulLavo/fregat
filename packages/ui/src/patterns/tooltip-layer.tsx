import { useId } from 'react'

import { Tooltip, TooltipContent } from '@workspace/ui/components/tooltip'
import {
  decodeTooltipParts,
  tooltipPartsText,
  type TooltipTone,
} from '@workspace/ui/patterns/tooltip-parts'
import { useTooltipLayer } from '@workspace/ui/patterns/use-tooltip-layer'

const TONE_CLASS: Record<TooltipTone, string> = {
  added: 'text-diff-added',
  default: '',
  muted: 'text-muted-foreground',
  removed: 'text-diff-removed',
}

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
  const parts = target ? decodeTooltipParts(target.text) : []

  return (
    <Tooltip open={target !== null}>
      <TooltipContent
        anchor={target?.element ?? null}
        aria-label={tooltipPartsText(parts)}
        id={id}
        side='bottom'
      >
        {parts.map((part, index) => (
          <span className={TONE_CLASS[part.tone ?? 'default']} key={index}>
            {part.text}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
