import { LoadingState } from '@workspace/ui/components/loading-state'

const lines = ['w-1/4', 'ml-4 w-1/2', 'ml-4 w-2/3', 'ml-8 w-5/12', 'ml-4 w-3/5', 'w-1/5'] as const

export function CompareSavedLoading() {
  return (
    <LoadingState className='h-full min-h-0 overflow-hidden font-mono' label='Loading saved file'>
      <div aria-hidden='true' className='py-3'>
        {lines.map((line) => (
          <div className='grid h-5 grid-cols-[44px_minmax(0,1fr)] items-center' key={line}>
            <div className='skeleton-sweep mr-3 ml-auto h-2 w-3' />
            <div className={`skeleton-sweep h-2.5 ${line}`} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
