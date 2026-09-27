import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { cn } from '@workspace/ui/lib/utils'
import {
  SHEET_BACKDROP_CLASS,
  SHEET_FRAME_CLASS,
  SHEET_POSITIONER_CLASS,
  SHEET_SURFACE_CLASS,
  PresentationContext,
  playSheetOpen,
  usePresentation,
  type Presentation,
} from '@workspace/ui/patterns/sheet'

function Popover({
  modal,
  onOpenChange,
  presentation: requested,
  ...props
}: PopoverPrimitive.Root.Props & {
  /** `anchored` keeps a surface on its anchor in the phone shell too (a menu that follows a caret). */
  readonly presentation?: Presentation
}) {
  const presentation = usePresentation(requested)
  return (
    // Decided once here, so the content, the modality and the voice agree.
    <PresentationContext value={presentation}>
      <PopoverPrimitive.Root
        data-slot='popover'
        // A sheet over a scrim is modal: scroll locked, focus kept inside, the page behind inert.
        modal={modal ?? presentation === 'sheet'}
        {...props}
        onOpenChange={(open, details) => {
          onOpenChange?.(open, details)
          if (!details.isCanceled) playSheetOpen(presentation, open, details.event)
        }}
      />
    </PresentationContext>
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />
}

function PopoverContent({
  className,
  children,
  align = 'center',
  alignOffset = 0,
  anchor,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'anchor' | 'side' | 'sideOffset'
  >) {
  const presentation = usePresentation()
  const sheet = presentation === 'sheet'
  return (
    <PopoverPrimitive.Portal>
      {sheet ? (
        <PopoverPrimitive.Backdrop data-slot='sheet-backdrop' className={SHEET_BACKDROP_CLASS} />
      ) : null}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        className={sheet ? SHEET_POSITIONER_CLASS : 'isolate z-50'}
      >
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          data-presentation={presentation}
          className={
            sheet
              ? cn(SHEET_SURFACE_CLASS, 'gap-(--density-popover-gap)', className, SHEET_FRAME_CLASS)
              : cn(
                  'z-50 flex w-72 origin-(--transform-origin) flex-col overscroll-contain gap-(--density-popover-gap) rounded-lg p-(--density-popover-padding) text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 bg-popover-solid outline-hidden ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                  className,
                )
          }
          {...props}
        >
          {children}
          {/* Base UI keeps focus inside a modal popover only while it holds a Close; a screen
              reader also uses it to leave the sheet. */}
          {sheet ? (
            <PopoverPrimitive.Close className='sr-only'>Close</PopoverPrimitive.Close>
          ) : null}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='popover-header'
      className={cn('flex flex-col gap-1 text-xs', className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot='popover-title'
      className={cn('text-sm font-medium', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot='popover-description'
      className={cn('text-xs/relaxed text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
