import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@workspace/ui/lib/utils'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Textarea } from '@workspace/ui/components/textarea'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='input-group'
      role='group'
      className={cn(
        'focus-ring-within group/input-group relative flex h-(--density-control-height) w-full min-w-0 items-center rounded-md border border-input outline-none has-disabled:bg-input/50 has-disabled:opacity-50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-1 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:bg-input/30 dark:has-disabled:bg-input/80 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-(--density-input-group-input-block-padding) has-[>[data-align=block-start]]:[&>input]:pb-(--density-input-group-input-block-padding) has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-(--density-input-group-addon-gap) py-(--density-input-group-addon-padding-y) text-xs font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-md [&>svg:not([class*='size-'])]:size-(--icon-size)",
  {
    variants: {
      align: {
        'inline-start':
          'order-first pl-(--density-input-group-inline-padding) has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem]',
        'inline-end':
          'order-last pr-(--density-input-group-inline-padding) has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem]',
        'block-start':
          'order-first w-full justify-start px-(--density-input-group-block-padding) pt-(--density-input-group-block-padding-y) group-has-[>input]/input-group:pt-(--density-input-group-block-padding-y) [.border-b]:pb-(--density-input-group-block-padding-y)',
        'block-end':
          'order-last w-full justify-start px-(--density-input-group-block-padding) pb-(--density-input-group-block-padding-y) group-has-[>input]/input-group:pb-(--density-input-group-block-padding-y) [.border-t]:pt-(--density-input-group-block-padding-y)',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role='group'
      data-slot='input-group-addon'
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva('flex items-center gap-2 text-xs shadow-none', {
  variants: {
    size: {
      xs: "h-6 gap-1 px-1.5 [&>svg:not([class*='size-'])]:size-(--icon-size-sm)",
      sm: 'gap-1',
      'icon-xs': 'size-6 p-0 has-[>svg]:p-0',
      'icon-sm': 'size-(--density-control-height-sm) p-0 has-[>svg]:p-0',
    },
  },
  defaultVariants: {
    size: 'xs',
  },
})

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size' | 'type'> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: 'button' | 'submit' | 'reset'
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        "flex items-center gap-(--density-input-group-addon-gap) text-xs text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-(--icon-size)",
        className,
      )}
      {...props}
    />
  )
}

// InputGroupInput and InputGroupTextarea fill the group edge to edge, so the group owns the
// radius and these stay square rather than drawing a corner inside a corner. The group also owns
// both rings, and silencing the control's own takes two different classes:
// `shadow-none!` kills the focus utility's raw box-shadow, while `aria-invalid:ring-0` kills the
// primitive's invalid ring — `shadow-none!` cannot, because it zeroes `--tw-shadow` and still
// composes `--tw-ring-shadow`.
function InputGroupInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot='input-group-control'
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none! disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot='input-group-control'
      className={cn(
        'flex-1 resize-none rounded-none border-0 bg-transparent shadow-none! disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
