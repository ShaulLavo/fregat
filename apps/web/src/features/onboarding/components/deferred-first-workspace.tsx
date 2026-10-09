import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { ModuleLoadError } from '@/components/module-load-error'
import { firstWorkspaceModuleQueryOptions } from '@/features/onboarding/utils/module-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

/** The empty chat and its project choice, loaded on demand. */
export function DeferredFirstWorkspace() {
  const query = useQuery(firstWorkspaceModuleQueryOptions, resourceQueryClient)
  if (query.isPending)
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center'>
        <Spinner size='md' label='Loading new chat' />
      </div>
    )
  if (query.isError)
    return (
      <ModuleLoadError className='flex-1' label='new chat' onRetry={() => void query.refetch()} />
    )

  const { FirstWorkspace } = query.data
  return (
    <RenderErrorBoundary label='new chat'>
      <FirstWorkspace />
    </RenderErrorBoundary>
  )
}
