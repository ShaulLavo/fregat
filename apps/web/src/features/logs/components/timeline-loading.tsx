import { logDashboardTimelineBucketCount } from '@workspace/contracts'
import { LoadingState } from '@workspace/ui/components/loading-state'

const bars = Array.from({ length: logDashboardTimelineBucketCount }, (_, index) => index)

export function LogsTimelineLoading() {
  return (
    <LoadingState className='px-2 py-2' label='Loading log summary'>
      <div aria-hidden='true'>
        <div className='text-3xs mb-2 grid grid-cols-4 gap-2'>
          {['Events', 'Errors', 'Warn', 'Slow'].map((label) => (
            <div className='bg-muted/20 min-w-0 px-1.5 py-1' key={label}>
              <div className='skeleton-sweep h-3 w-8 rounded-md' />
              <div className='text-muted-foreground truncate'>{label}</div>
            </div>
          ))}
        </div>
        <div className='flex h-14 items-end gap-px overflow-hidden'>
          {bars.map((bar) => (
            <div className='flex h-full min-w-[3px] flex-1 items-end' key={bar}>
              <div className='skeleton-sweep h-1 w-full' />
            </div>
          ))}
        </div>
      </div>
    </LoadingState>
  )
}
