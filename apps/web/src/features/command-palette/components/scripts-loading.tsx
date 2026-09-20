import { LoadingState } from '@workspace/ui/components/loading-state'

/** One row tall: a cmdk item has the row's fixed height, so a taller skeleton spills over its neighbours. */
export function ScriptsLoading() {
  return (
    <LoadingState className='w-full' label='Loading scripts'>
      <div aria-hidden='true' className='flex items-center gap-2'>
        <div className='skeleton-sweep size-(--icon-size) shrink-0 rounded-md' />
        <div className='skeleton-sweep h-2.5 w-1/4 rounded-md' />
        <div className='skeleton-sweep ml-auto h-2.5 w-24 rounded-md' />
      </div>
    </LoadingState>
  )
}
