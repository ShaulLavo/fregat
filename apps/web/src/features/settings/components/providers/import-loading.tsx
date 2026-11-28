import { LoadingState } from '@workspace/ui/components/loading-state'

export function ImportLoading() {
  return (
    <LoadingState label='Loading import sources'>
      <div aria-hidden='true'>
        {[0, 1].map((row) => (
          <div className='flex items-center justify-between gap-3 py-3' key={row}>
            <div className='skeleton-sweep h-3.5 w-28 rounded-md' />
            <div className='skeleton-sweep h-(--density-control-height-sm) w-16 rounded-md' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
