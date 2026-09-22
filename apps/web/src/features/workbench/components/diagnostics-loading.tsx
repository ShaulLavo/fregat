import { LoadingState } from '@workspace/ui/components/loading-state'
import { cn } from '@workspace/ui/lib/utils'

import { diagnosticRuleClass } from '@/features/workbench/utils/diagnostic-style'

/** One placeholder per real element: the path line, then a row per diagnostic. */
export function DiagnosticsLoading() {
  return (
    <LoadingState className='h-full min-h-0 flex-1' label='Loading diagnostics'>
      <div aria-hidden='true' className='h-full overflow-hidden p-3'>
        <div className='skeleton-sweep mb-3 h-3 w-2/5 rounded-md' />
        <div className='space-y-2'>
          {[1, 2, 3].map((severity) => (
            <div className={cn('border-l-2', diagnosticRuleClass(severity))} key={severity}>
              <div className='space-y-1 px-(--density-row-padding-x) py-(--density-gap-tight)'>
                <div className='skeleton-sweep h-2 w-14 rounded-md' />
                <div className='skeleton-sweep h-3 w-3/4 rounded-md' />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingState>
  )
}
