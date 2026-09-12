import { LoadingState } from '@workspace/ui/components/loading-state'

export function RecentsLoading() {
  return (
    <LoadingState label='Loading recents'>
      <div aria-hidden='true' className='space-y-0.5'>
        <div className='flex h-(--density-control-height) items-center gap-(--density-control-gap) px-(--density-control-padding-x)'>
          <div className='skeleton-sweep size-4 rounded-md' />
          <div className='skeleton-sweep h-3 w-2/3 rounded-md' />
        </div>
        <div className='flex h-(--density-control-height) items-center gap-(--density-control-gap) px-(--density-control-padding-x)'>
          <div className='skeleton-sweep size-4 rounded-md' />
          <div className='skeleton-sweep h-3 w-1/2 rounded-md' />
        </div>
      </div>
    </LoadingState>
  )
}
