import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { cn } from '@workspace/ui/lib/utils'

/** One delay for every tooltip, including the shared layer's controlled one. */
export const TOOLTIP_DELAY = 400

function TooltipProvider({ delay = TOOLTIP_DELAY, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot='tooltip-provider' delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot='tooltip' {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />
}

function TooltipContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  anchor,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'anchor' | 'side' | 'sideOffset'
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50'
      >
        <TooltipPrimitive.Popup
          data-slot='tooltip-content'
          className={cn(
            'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-(--density-tooltip-gap) rounded-lg bg-popover-solid px-(--density-tooltip-padding-x) py-(--density-tooltip-padding-y) text-xs text-foreground shadow-md ring-1 ring-foreground/10 ease-out-strong has-data-[slot=kbd]:pr-(--density-tooltip-kbd-padding-right) data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) **:data-[slot=kbd]:rounded-md data-instant:duration-0 data-instant:animation-duration-0! data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
