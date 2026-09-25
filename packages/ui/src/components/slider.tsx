import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@workspace/ui/lib/utils'

/** One value on a track. The fill and the thumb are the only surfaces; the track is a tint. */
function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot='slider'
      className={cn('flex w-full touch-none items-center select-none', className)}
      {...props}
    >
      <SliderPrimitive.Control className='flex h-(--density-control-height-sm) w-full items-center'>
        <SliderPrimitive.Track className='bg-muted relative h-1 w-full rounded-full'>
          <SliderPrimitive.Indicator className='bg-primary rounded-full' />
          <SliderPrimitive.Thumb className='focus-ring bg-background ring-foreground/10 size-3.5 rounded-full ring-1' />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
