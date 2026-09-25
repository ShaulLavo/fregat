import { playControlFeedback } from '@workspace/ui/patterns/feedback-layer'
;('use client')

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@workspace/ui/lib/utils'

function Switch({
  className,
  size = 'default',
  onCheckedChange,
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot='switch'
      data-press-depth
      data-size={size}
      className={cn(
        'shadow-(--shadow-well) focus-ring peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent outline-none after:absolute after:-inset-x-3 after:-inset-y-2 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      onCheckedChange={(value, details) => {
        onCheckedChange?.(value, details)
        if (details.isCanceled) return
        playControlFeedback(value ? 'tick' : 'tick-off', details.event)
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot='switch-thumb'
        className='bg-card-solid dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground pointer-events-none block rounded-full shadow-(--shadow-key) ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0'
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
