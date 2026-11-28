import { LoadingState } from '@workspace/ui/components/loading-state'

/** One placeholder per element the loaded section draws: headline, chart, three model rows. */
export function UsageLoading() {
  return (
    <LoadingState className='flex flex-col gap-4' label='Loading usage'>
      <div aria-hidden='true' className='flex flex-col gap-1.5'>
        <div className='skeleton-sweep h-4 w-20 rounded-md' />
        <div className='skeleton-sweep h-2.5 w-40 rounded-md' />
      </div>
      <div aria-hidden='true' className='skeleton-sweep h-20 w-full rounded-md' />
      <div aria-hidden='true' className='flex flex-col gap-2'>
        {[0, 1, 2].map((row) => (
          <div className='flex items-center gap-3' key={row}>
            <div className='skeleton-sweep h-3 flex-1 rounded-md' />
            <div className='skeleton-sweep h-3 w-16 rounded-md' />
            <div className='skeleton-sweep h-3 w-12 rounded-md' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
