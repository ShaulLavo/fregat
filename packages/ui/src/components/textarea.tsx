import * as React from 'react'

import { cn } from '@workspace/ui/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'shadow-(--shadow-well) focus-ring flex field-sizing-content min-h-(--density-textarea-min-height) w-full rounded-md border border-transparent bg-input/30 px-(--density-control-padding-x) py-(--density-textarea-padding-y) text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
