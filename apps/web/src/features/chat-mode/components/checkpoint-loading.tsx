import { LoadingState } from '@workspace/ui/components/loading-state'

export function CheckpointLoading() {
  return (
    <LoadingState
      className='h-full min-h-0 px-(--density-control-padding-x) py-(--density-section-gap)'
      label='Loading checkpoint'
    >
      <div aria-hidden='true' className='space-y-1'>
        <div className='mb-1.5 flex items-center gap-2'>
          <div className='skeleton-sweep h-2.5 w-20 rounded-md' />
          <div className='skeleton-sweep h-2.5 w-10 rounded-md' />
        </div>
        <div className='flex h-(--density-control-height-sm) items-center gap-2'>
          <div className='skeleton-sweep h-3 min-w-0 flex-1 rounded-md' />
          <div className='bg-diff-added/20 h-2.5 w-6 rounded-md' />
          <div className='bg-diff-removed/20 h-2.5 w-5 rounded-md' />
        </div>
        <div className='flex h-(--density-control-height-sm) items-center gap-2'>
          <div className='skeleton-sweep h-3 w-3/4 rounded-md' />
          <div className='bg-diff-added/20 ml-auto h-2.5 w-5 rounded-md' />
          <div className='bg-diff-removed/20 h-2.5 w-4 rounded-md' />
        </div>
        <div className='flex h-(--density-control-height-sm) items-center gap-2'>
          <div className='skeleton-sweep h-3 w-1/2 rounded-md' />
          <div className='bg-diff-added/20 ml-auto h-2.5 w-6 rounded-md' />
          <div className='bg-diff-removed/20 h-2.5 w-5 rounded-md' />
        </div>
      </div>
    </LoadingState>
  )
}
