import { LoadingState } from '@workspace/ui/components/loading-state'

export function LogsListLoading() {
  return (
    <LoadingState className='flex min-h-0 flex-1 flex-col gap-3 p-6' label='Loading logs'>
      <div className='skeleton-sweep h-4 w-3/4 rounded-md' />
      <div className='skeleton-sweep h-4 w-1/2 rounded-md' />
      <div className='skeleton-sweep h-4 w-2/3 rounded-md' />
    </LoadingState>
  )
}
