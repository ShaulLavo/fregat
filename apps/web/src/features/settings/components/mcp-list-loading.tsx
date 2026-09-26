import { LoadingState } from '@workspace/ui/components/loading-state'

/** Mirrors one source group of server rows. */
export function McpListLoading() {
  return (
    <LoadingState label='Reading MCP servers'>
      <div aria-hidden='true' className='flex flex-col'>
        <div className='flex h-6 items-center'>
          <div className='skeleton-sweep h-2.5 w-16 rounded-md' />
        </div>
        <ul className='bg-muted flex flex-col rounded-lg px-(--density-control-padding-x)'>
          {[0, 1].map((row) => (
            <li className='flex items-center gap-3 py-2' key={row}>
              <div className='flex min-w-0 flex-1 flex-col'>
                <div className='flex h-5 items-center'>
                  <div className='skeleton-sweep h-3.5 w-28 rounded-md' />
                </div>
                <div className='flex h-4 items-center'>
                  <div className='skeleton-sweep h-2.5 w-48 rounded-md' />
                </div>
              </div>
              <div className='skeleton-sweep h-(--density-control-height-sm) w-16 rounded-md' />
            </li>
          ))}
        </ul>
      </div>
    </LoadingState>
  )
}
