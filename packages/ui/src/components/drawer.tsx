import { playControlFeedback } from '@workspace/ui/patterns/feedback-layer'

import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'

import { cn } from '@workspace/ui/lib/utils'

function Drawer({ onOpenChange, ...props }: DrawerPrimitive.Root.Props) {
  return (
    <DrawerPrimitive.Root
      data-slot='drawer'
      {...props}
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details)
        if (open && !details.isCanceled) playControlFeedback('open', details.event)
      }}
    />
  )
}

/**
 * A bottom-edge surface over the page. It slides in and out and follows the pointer while
 * swiped; the page behind keeps its size.
 */
function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal data-slot='drawer-portal'>
      <DrawerPrimitive.Viewport
        data-slot='drawer-viewport'
        className='fixed inset-x-0 bottom-0 z-40'
      >
        <DrawerPrimitive.Popup
          data-slot='drawer-content'
          className={cn(
            'flex w-full flex-col bg-popover-solid text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none',
            'translate-y-[calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))] transition-[translate] duration-(--duration-enter) ease-out-strong',
            'data-starting-style:translate-y-full data-ending-style:translate-y-full data-ending-style:duration-(--duration-exit) data-swiping:duration-0 motion-reduce:transition-none',
            className,
          )}
          {...props}
        >
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  )
}

export { Drawer, DrawerContent }
