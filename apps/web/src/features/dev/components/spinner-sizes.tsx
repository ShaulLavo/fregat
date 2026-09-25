import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { SPINNER_SIZES } from '@/features/dev/utils/loader-samples'

export function SpinnerSizes() {
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-(--density-control-gap)'>
      {SPINNER_SIZES.map(({ size, use }) => (
        <div
          className='bg-background flex flex-col items-center gap-2 rounded-md p-(--density-section-padding)'
          key={size}
        >
          <div className='flex h-12 items-center'>
            <Spinner size={size} />
          </div>
          <span className='text-xs font-medium'>{size}</span>
          <span className='text-muted-foreground text-2xs'>{use}</span>
        </div>
      ))}
      <div className='bg-background flex flex-col items-center gap-2 rounded-md p-(--density-section-padding)'>
        <div className='flex h-12 items-center'>
          <Button variant='outline'>
            <Spinner />
            Saving
          </Button>
        </div>
        <span className='text-xs font-medium'>no size</span>
        <span className='text-muted-foreground text-2xs'>The button sizes it</span>
      </div>
    </div>
  )
}
