import { LoadingState } from '@workspace/ui/components/loading-state'

export function PushLoading() {
  return (
    <LoadingState label='Loading push devices'>
      <div aria-hidden='true' className='flex flex-col gap-3'>
        <div className='skeleton-sweep h-(--density-control-height-sm) w-40 rounded-md' />
        <ul className='flex flex-col'>
          {[0, 1].map((row) => (
            <li className='flex flex-col gap-2 py-2' key={row}>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='flex h-5 items-center'>
                    <div className='skeleton-sweep h-3.5 w-32 rounded-md' />
                  </div>
                  <div className='flex h-4 items-center'>
                    <div className='skeleton-sweep h-2.5 w-24 rounded-md' />
                  </div>
                </div>
                <div className='flex shrink-0 items-center gap-(--density-gap)'>
                  <div className='skeleton-sweep h-(--density-control-height-sm) w-20 rounded-md' />
                  <div className='skeleton-sweep h-(--density-control-height-sm) w-16 rounded-md' />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </LoadingState>
  )
}
