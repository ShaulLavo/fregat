import { FILE_LIST_GRID } from '@/features/file-picker/utils/rows'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

export function ListLoading() {
  return (
    <LoadingState className='h-full overflow-hidden' label='Loading folder'>
      <div aria-hidden='true' className='h-full overflow-hidden'>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            className={cn(
              'grid h-(--density-row-height) items-center gap-(--density-control-gap) px-(--density-row-padding-x)',
              FILE_LIST_GRID,
            )}
            key={row}
          >
            <div className='flex min-w-0 items-center gap-2'>
              <div className='skeleton-sweep size-4 shrink-0 rounded-md' />
              <div className='skeleton-sweep h-3 w-2/3 max-w-48 rounded-md' />
            </div>
            <div className='skeleton-sweep h-2.5 w-16 rounded-md max-sm:hidden' />
            <div className='skeleton-sweep ml-auto h-2.5 w-10 rounded-md max-sm:hidden' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
