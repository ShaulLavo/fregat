import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@workspace/ui/lib/utils'

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg px-(--density-control-padding-x) py-(--density-alert-padding-y) text-left text-xs has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-(--icon-size)",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90',
        warning: 'bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning/90',
        info: 'bg-info/10 text-info *:data-[slot=alert-description]:text-info/90',
        success: 'bg-success/10 text-success *:data-[slot=alert-description]:text-success/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot='alert'
      role='alert'
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-title'
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-description'
      className={cn(
        'text-xs/relaxed text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2',
        className,
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-action'
      className={cn(
        'absolute top-[calc(--spacing(1.25))] right-[calc(--spacing(1.25))]',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
