import { fileListGridClass } from '@/features/file-picker/utils/list-layout'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

import type { FilePickerMode } from '@/features/file-picker/model'

export function ListLoading({ mode }: { mode: FilePickerMode }) {
  return (
    <LoadingState className='h-full overflow-hidden' label='Loading folder'>
      <div aria-hidden='true' className='h-full overflow-hidden py-(--density-control-gap)'>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            className={cn(
              'grid h-8 items-center gap-(--density-control-gap) px-3',
              fileListGridClass(mode),
            )}
            key={row}
          >
            <div className='flex min-w-0 items-center gap-2'>
              <div className='skeleton-sweep size-4 shrink-0 rounded-md' />
              <div className='skeleton-sweep h-3 w-2/3 max-w-48' />
            </div>
            {mode === 'file' ? <div className='skeleton-sweep h-2.5 w-12' /> : null}
            <div className='skeleton-sweep h-2.5 w-16 max-sm:hidden' />
            <div className='skeleton-sweep ml-auto h-2.5 w-10 max-sm:hidden' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
