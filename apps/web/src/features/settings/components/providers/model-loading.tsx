import { LoadingState } from '@workspace/ui/components/loading-state'

export function ModelLoading() {
  return (
    <LoadingState
      className='bg-muted flex w-96 max-w-full min-w-0 flex-col rounded-lg @max-3xl/settings:w-full'
      label='Loading models'
    >
      {[0, 1, 2].map((row) => (
        <div
          aria-hidden='true'
          className='flex items-center gap-2 px-(--density-control-padding-x) py-(--density-section-gap)'
          key={row}
        >
          <div className='flex min-w-0 flex-1 flex-col gap-1.5 py-1'>
            <div className='skeleton-sweep h-3 w-32 rounded-md' />
            <div className='skeleton-sweep h-2.5 w-16 rounded-md' />
          </div>
          <div className='skeleton-sweep size-(--icon-size) rounded-md' />
          <div className='skeleton-sweep size-(--icon-size) rounded-md' />
          <div className='skeleton-sweep h-4 w-7 rounded-full' />
        </div>
      ))}
    </LoadingState>
  )
}
