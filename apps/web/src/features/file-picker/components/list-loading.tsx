import { fileListGridClass } from '@/features/file-picker/utils/list-layout'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

import { filePickerDensityMetrics } from '@/features/file-picker/utils/density'
import { useWorkbenchDensity } from '@/features/settings/hooks/use-workbench-density'

import type { FilePickerMode } from '@/features/file-picker/model'

export function ListLoading({ mode }: { mode: FilePickerMode }) {
  const density = useWorkbenchDensity()
  const metrics = filePickerDensityMetrics(density)

  return (
    <LoadingState className='h-full overflow-hidden' label='Loading folder'>
      {/* Insets and row height are the real virtual row's, so the list does not shift on load. */}
      <div aria-hidden='true' className='h-full overflow-hidden px-1.5'>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div
            className={cn(
              'grid items-center gap-(--density-control-gap) px-2',
              fileListGridClass(mode),
            )}
            key={row}
            style={{ height: metrics.entryRowSize }}
          >
            <div className='flex min-w-0 items-center gap-2'>
              <div className='skeleton-sweep size-4 shrink-0 rounded-md' />
              <div className='skeleton-sweep h-3 w-2/3 max-w-48 rounded-md' />
            </div>
            {mode === 'file' ? <div className='skeleton-sweep h-2.5 w-12 rounded-md' /> : null}
            <div className='skeleton-sweep h-2.5 w-16 rounded-md max-sm:hidden' />
            <div className='skeleton-sweep ml-auto h-2.5 w-10 rounded-md max-sm:hidden' />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
