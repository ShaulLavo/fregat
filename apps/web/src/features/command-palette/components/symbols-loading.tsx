import { LoadingState } from '@workspace/ui/components/loading-state'

export function SymbolsLoading() {
  return (
    <LoadingState className='w-full' label='Loading symbols'>
      <div aria-hidden='true' className='space-y-2 py-0.5'>
        <div className='grid grid-cols-[16px_minmax(0,1fr)_28px] items-center gap-2'>
          <div className='skeleton-sweep size-3.5 rounded-md' />
          <div className='space-y-1'>
            <div className='skeleton-sweep h-2.5 w-2/5' />
            <div className='skeleton-sweep h-2 w-3/5' />
          </div>
          <div className='skeleton-sweep ml-auto h-2.5 w-5' />
        </div>
        <div className='grid grid-cols-[16px_minmax(0,1fr)_28px] items-center gap-2'>
          <div className='skeleton-sweep size-3.5 rounded-md' />
          <div className='space-y-1'>
            <div className='skeleton-sweep h-2.5 w-1/3' />
            <div className='skeleton-sweep h-2 w-1/2' />
          </div>
          <div className='skeleton-sweep ml-auto h-2.5 w-4' />
        </div>
      </div>
    </LoadingState>
  )
}
