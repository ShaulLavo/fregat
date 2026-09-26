import type { ComponentProps } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * The one way to draw a key. The fill mixes the surrounding text colour, so the chip reads on a
 * tooltip, a menu and a pane alike. `data-slot='kbd'` is the hook TooltipContent tightens for.
 */
function Kbd({ className, size = 'sm', ...props }: ComponentProps<'kbd'> & { size?: 'sm' | 'md' }) {
  return (
    <kbd
      data-slot='kbd'
      className={cn(
        'inline-flex items-center rounded-md bg-current/10 font-mono leading-none tracking-normal whitespace-nowrap',
        size === 'md' ? 'px-1.5 py-1 text-xs' : 'px-1 py-0.5 text-3xs',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
