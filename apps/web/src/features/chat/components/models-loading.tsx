import { LoadingState } from '@workspace/ui/components/loading-state'

/**
 * Stands in for the picker's model rows. It carries the row's own geometry —
 * the command-item density variables, and a line box per `text-xs leading-snug`
 * line — so the list does not jump when the providers arrive.
 */
export function ModelsLoading() {
  return (
    <LoadingState label='Loading providers'>
      <div aria-hidden='true' className='space-y-1'>
        <div className='flex items-center gap-(--density-command-item-gap) px-(--density-command-item-padding-x) py-(--density-command-item-padding-y)'>
          <div className='min-w-0 flex-1'>
            <div className='flex h-4.25 items-center'>
              <div className='skeleton-sweep h-3 w-2/5 rounded-md' />
            </div>
            <div className='mt-(--density-gap-tight) flex h-4.25 items-center gap-1.5'>
              <div className='skeleton-sweep size-3 rounded-md' />
              <div className='skeleton-sweep h-2.5 w-1/3 rounded-md' />
            </div>
          </div>
          <div className='skeleton-sweep h-4 w-12 rounded-md' />
        </div>
        <div className='flex items-center gap-(--density-command-item-gap) px-(--density-command-item-padding-x) py-(--density-command-item-padding-y)'>
          <div className='min-w-0 flex-1'>
            <div className='flex h-4.25 items-center'>
              <div className='skeleton-sweep h-3 w-1/2 rounded-md' />
            </div>
            <div className='mt-(--density-gap-tight) flex h-4.25 items-center gap-1.5'>
              <div className='skeleton-sweep size-3 rounded-md' />
              <div className='skeleton-sweep h-2.5 w-2/5 rounded-md' />
            </div>
          </div>
          <div className='flex gap-1'>
            <div className='skeleton-sweep h-4 w-9 rounded-md' />
            <div className='skeleton-sweep h-4 w-11 rounded-md' />
          </div>
        </div>
        <div className='flex items-center gap-(--density-command-item-gap) px-(--density-command-item-padding-x) py-(--density-command-item-padding-y)'>
          <div className='min-w-0 flex-1'>
            <div className='flex h-4.25 items-center'>
              <div className='skeleton-sweep h-3 w-1/3 rounded-md' />
            </div>
            <div className='mt-(--density-gap-tight) flex h-4.25 items-center gap-1.5'>
              <div className='skeleton-sweep size-3 rounded-md' />
              <div className='skeleton-sweep h-2.5 w-1/4 rounded-md' />
            </div>
          </div>
          <div className='skeleton-sweep h-4 w-14 rounded-md' />
        </div>
      </div>
    </LoadingState>
  )
}
