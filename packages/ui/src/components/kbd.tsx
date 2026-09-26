import type { ComponentProps } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * The one way to draw a key. The fill mixes the surrounding text colour, so the chip reads on a
 * tooltip, a menu and a pane alike. `data-slot='kbd'` is the hook TooltipContent tightens for.
 */
function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot='kbd'
      className={cn(
        'inline-flex items-center rounded-md bg-current/10 px-1 py-0.5 font-mono text-3xs leading-none tracking-normal whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
