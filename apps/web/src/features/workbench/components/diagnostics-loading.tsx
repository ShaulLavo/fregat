import { LoadingState } from '@workspace/ui/components/loading-state'

export function DiagnosticsLoading() {
  return (
    <LoadingState className='h-full min-h-0 flex-1' label='Loading diagnostics'>
      <div aria-hidden='true' className='h-full overflow-hidden p-3'>
        <div className='skeleton-sweep mb-3 h-3 w-2/5' />
        <div className='grid grid-cols-4 gap-2'>
          <div className='border-destructive/25 space-y-1 rounded-lg border px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-10' />
            <div className='bg-destructive/20 h-3 w-5 rounded-md' />
          </div>
          <div className='border-warning/25 space-y-1 rounded-lg border px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-12' />
            <div className='bg-warning/20 h-3 w-5 rounded-md' />
          </div>
          <div className='border-info/25 space-y-1 rounded-lg border px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-8' />
            <div className='bg-info/20 h-3 w-5 rounded-md' />
          </div>
          <div className='border-border space-y-1 rounded-lg border px-2 py-1.5'>
            <div className='skeleton-sweep h-2 w-9' />
            <div className='skeleton-sweep h-3 w-5 rounded-md' />
          </div>
        </div>
        <div className='mt-3 space-y-2'>
          <div className='border-border border-l-destructive space-y-1 rounded-lg border border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-12' />
            <div className='skeleton-sweep h-3 w-4/5' />
          </div>
          <div className='border-border border-l-warning space-y-1 rounded-lg border border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-16' />
            <div className='skeleton-sweep h-3 w-2/3' />
          </div>
          <div className='border-border border-l-info space-y-1 rounded-lg border border-l-2 px-2 py-2'>
            <div className='skeleton-sweep h-2 w-10' />
            <div className='skeleton-sweep h-3 w-3/4' />
          </div>
        </div>
      </div>
    </LoadingState>
  )
}
