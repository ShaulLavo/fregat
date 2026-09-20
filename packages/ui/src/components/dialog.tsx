'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { cn } from '@workspace/ui/lib/utils'
import { Button } from '@workspace/ui/components/button'
import { XIcon } from '@phosphor-icons/react'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot='dialog-overlay'
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

/* 'right' is the edge-anchored drawer: it spans the viewport height against the
   right edge, so it carries no radius — rounded corners would notch the edges. */
const sideClasses = {
  center:
    'top-1/2 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg sm:max-w-sm data-open:zoom-in-95 data-closed:zoom-out-95',
  right:
    'top-0 right-0 h-dvh max-h-dvh max-w-xl sm:max-w-xl data-open:slide-in-from-right-4 data-closed:slide-out-to-right-4',
} as const

function DialogContent({
  className,
  children,
  overlayClassName,
  showCloseButton = true,
  side = 'center',
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  overlayClassName?: string
  side?: keyof typeof sideClasses
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot='dialog-content'
        className={cn(
          'fixed z-50 grid w-full gap-(--density-dialog-gap) p-(--density-dialog-padding) bg-popover-solid text-xs/relaxed text-popover-foreground shadow-xl ring-1 ring-foreground/10 ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot='dialog-close'
            render={<Button variant='ghost' className='absolute top-2 right-2' size='icon-sm' />}
          >
            <XIcon />
            <span className='sr-only'>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-header'
      className={cn('flex flex-col gap-1 text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot='dialog-footer'
      className={cn(
        'flex flex-col-reverse gap-(--density-section-gap) sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant='outline' />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn('font-heading text-sm font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn(
        'text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
