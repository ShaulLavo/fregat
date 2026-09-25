import { LoadingState } from '@workspace/ui/components/loading-state'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { SKELETON_ROW_WIDTHS } from '@/features/dev/utils/loader-samples'

export function OtherLoaders() {
  return (
    <div className='grid gap-(--density-control-gap) md:grid-cols-2'>
      <div className='bg-background rounded-md py-(--density-section-padding)'>
        <LoadingState delayMs={0} label='Loading rows'>
          {SKELETON_ROW_WIDTHS.map((width) => (
            <div
              className='flex h-(--density-row-height) items-center gap-2 px-(--density-row-padding-x)'
              key={width}
            >
              <div className='skeleton-sweep size-(--icon-size-sm) rounded-md' />
              <div className={`skeleton-sweep h-2.5 rounded-md ${width}`} />
            </div>
          ))}
        </LoadingState>
      </div>
      <div className='bg-background flex items-center rounded-md p-(--density-section-padding) text-sm'>
        <p>
          The agent is <Shimmer>reading the workspace</Shimmer> before it answers.
        </p>
      </div>
    </div>
  )
}
