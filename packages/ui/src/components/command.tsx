'use client'

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'

import { cn } from '@workspace/ui/lib/utils'
import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { InputGroup, InputGroupAddon } from '@workspace/ui/components/input-group'
import { MagnifyingGlassIcon, CheckIcon } from '@phosphor-icons/react'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot='command'
      className={cn('flex size-full flex-col overflow-hidden text-popover-foreground', className)}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run…',
  children,
  className,
  commandProps,
  commandKey,
  contentRef,
  finalFocus,
  overlayClassName,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  title?: string
  description?: string
  className?: string
  commandProps?: Omit<React.ComponentProps<typeof CommandPrimitive>, 'children'>
  commandKey?: React.Key
  contentRef?: React.Ref<HTMLDivElement>
  finalFocus?: React.ComponentProps<typeof DialogContent>['finalFocus']
  overlayClassName?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className='sr-only'>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        // VS Code's quick input geometry: 600px wide, pinned near the top of the
        // window rather than centered, so the palette never sits on top of the
        // content it is being used to act on.
        className={cn(
          'top-8 w-full translate-y-0 overflow-hidden p-0 shadow-xl sm:max-w-[600px]',
          className,
        )}
        overlayClassName={overlayClassName}
        finalFocus={finalFocus}
        ref={contentRef}
        showCloseButton={showCloseButton}
      >
        <Command key={commandKey} {...commandProps}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  scope,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { scope?: React.ReactNode }) {
  return (
    // A bare line, not a boxed field: the group inside carries border-none, so
    // this bottom border is the only thing that can show focus.
    <div
      data-slot='command-input-wrapper'
      className='focus-within:border-ring border-b border-transparent pb-0 transition-colors'
    >
      <InputGroup className='bg-input/30 h-(--density-command-input-height) border-none shadow-none! *:data-[slot=input-group-addon]:pl-(--density-command-input-padding-x)!'>
        <CommandPrimitive.Input
          data-slot='command-input'
          className={cn(
            'w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <MagnifyingGlassIcon className='size-(--icon-size) shrink-0 opacity-50' />
          {scope}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot='command-list'
      className={cn(
        'no-scrollbar max-h-72 scroll-py-0 overflow-x-hidden overflow-y-auto outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot='command-empty'
      className={cn('py-6 text-center text-xs', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot='command-group'
      className={cn(
        'overflow-hidden text-foreground **:[[cmdk-group-heading]]:px-(--density-command-heading-padding-x) **:[[cmdk-group-heading]]:pt-(--density-command-heading-padding-top) **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-2xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:tracking-wide **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot='command-separator'
      className={cn('-mx-1 h-px', className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot='command-item'
      className={listRowClassName({
        className: cn(
          "group/command-item cursor-default [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--icon-size-sm)",
          className,
        ),
      })}
      {...props}
    >
      {children}
      <CheckIcon className='ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100' />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot='command-shortcut'
      className={cn(
        'ml-auto whitespace-nowrap text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { useCommandState } from 'cmdk'

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
