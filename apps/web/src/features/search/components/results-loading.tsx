import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

export function SearchResultsLoading({ className }: { className?: string }) {
  return (
    <LoadingState className={cn('h-full min-h-0 overflow-hidden', className)} label='Searching'>
      <div aria-hidden='true' className='h-full overflow-hidden py-1'>
        {/* h-6 is the loaded file-group header height, and the loaded list draws no
            rule between groups, so neither does the skeleton. */}
        <div className='flex h-6 items-center gap-1.5 px-2'>
          <div className='skeleton-sweep size-3 rounded-md' />
          <div className='skeleton-sweep size-3.5 rounded-md' />
          <div className='skeleton-sweep h-3 w-28 rounded-md' />
          <div className='skeleton-sweep ml-auto h-4 w-6 rounded-md' />
        </div>
        <div className='space-y-0.5 pb-1'>
          <div className='grid h-6 grid-cols-[34px_minmax(0,1fr)] items-center gap-1.5 px-1.5'>
            <div className='skeleton-sweep ml-auto h-2.5 w-5 rounded-md' />
            <div className='skeleton-sweep h-2.5 w-3/4 rounded-md' />
          </div>
          <div className='grid h-6 grid-cols-[34px_minmax(0,1fr)] items-center gap-1.5 px-1.5'>
            <div className='skeleton-sweep ml-auto h-2.5 w-4 rounded-md' />
            <div className='skeleton-sweep h-2.5 w-4/5 rounded-md' />
          </div>
          <div className='grid h-6 grid-cols-[34px_minmax(0,1fr)] items-center gap-1.5 px-1.5'>
            <div className='skeleton-sweep ml-auto h-2.5 w-5 rounded-md' />
            <div className='skeleton-sweep h-2.5 w-2/3 rounded-md' />
          </div>
        </div>
        <div className='flex h-6 items-center gap-1.5 px-2'>
          <div className='skeleton-sweep size-3 rounded-md' />
          <div className='skeleton-sweep size-3.5 rounded-md' />
          <div className='skeleton-sweep h-3 w-36 rounded-md' />
          <div className='skeleton-sweep ml-auto h-4 w-6 rounded-md' />
        </div>
        <div className='grid h-6 grid-cols-[34px_minmax(0,1fr)] items-center gap-1.5 px-1.5'>
          <div className='skeleton-sweep ml-auto h-2.5 w-4 rounded-md' />
          <div className='skeleton-sweep h-2.5 w-3/5 rounded-md' />
        </div>
      </div>
    </LoadingState>
  )
}
