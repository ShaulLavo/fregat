import { LoadingState } from '@workspace/ui/components/loading-state'

export function DiagnosticsLoading() {
  return (
    <LoadingState className='h-full min-h-0 flex-1' label='Loading diagnostics'>
      <div aria-hidden='true' className='h-full overflow-hidden p-3'>
        <div className='skeleton-sweep mb-3 h-3 w-2/5 rounded-md' />
        <div className='grid grid-cols-4 gap-2'>
          <div className='bg-destructive/10 space-y-1 rounded-lg px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-10 rounded-md' />
            <div className='bg-destructive/20 h-3 w-5 rounded-md' />
          </div>
          <div className='bg-warning/10 space-y-1 rounded-lg px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-12 rounded-md' />
            <div className='bg-warning/20 h-3 w-5 rounded-md' />
          </div>
          <div className='bg-info/10 space-y-1 rounded-lg px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-8 rounded-md' />
            <div className='bg-info/20 h-3 w-5 rounded-md' />
          </div>
          <div className='bg-muted space-y-1 rounded-lg px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-9 rounded-md' />
            <div className='skeleton-sweep h-3 w-5 rounded-md' />
          </div>
        </div>
        <div className='mt-3 space-y-2'>
          <div className='border-l-destructive space-y-1 rounded-lg border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-12 rounded-md' />
            <div className='skeleton-sweep h-3 w-4/5 rounded-md' />
          </div>
          <div className='border-l-warning space-y-1 rounded-lg border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-16 rounded-md' />
            <div className='skeleton-sweep h-3 w-2/3 rounded-md' />
          </div>
          <div className='border-l-info space-y-1 rounded-lg border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-10 rounded-md' />
            <div className='skeleton-sweep h-3 w-3/4 rounded-md' />
          </div>
        </div>
      </div>
    </LoadingState>
  )
}
