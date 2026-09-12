import { LoadingState } from '@workspace/ui/components/loading-state'
import { PaneBar } from '@workspace/ui/components/pane-bar'

export function TreeLoading() {
  return (
    <LoadingState className='h-full overflow-hidden' label='Loading folder'>
      <div aria-hidden='true' className='h-full overflow-hidden'>
        {/* Same bar as TreeToolbar, so the header does not jump once the tree loads. */}
        <PaneBar border='bottom'>
          <div className='skeleton-sweep h-3 w-16 rounded-md' />
          <div className='ml-auto flex gap-1.5'>
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
          </div>
        </PaneBar>
        <div className='py-(--density-control-gap)'>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5'>
            <div className='skeleton-sweep size-3 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-24 rounded-md' />
          </div>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5 pl-5'>
            <div className='skeleton-sweep size-3 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-32 rounded-md' />
          </div>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5 pl-9'>
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-28 rounded-md' />
          </div>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5 pl-9'>
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-20 rounded-md' />
          </div>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5 pl-5'>
            <div className='skeleton-sweep size-3 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-24 rounded-md' />
          </div>
          <div className='flex h-(--density-row-height) items-center gap-1.5 px-1.5'>
            <div className='skeleton-sweep size-3 rounded-md' />
            <div className='skeleton-sweep size-3.5 rounded-md' />
            <div className='skeleton-sweep h-3 w-28 rounded-md' />
          </div>
        </div>
      </div>
    </LoadingState>
  )
}
