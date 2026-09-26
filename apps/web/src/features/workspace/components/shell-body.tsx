import { ModuleLoadError } from '@/components/module-load-error'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { LoadingState } from '@workspace/ui/components/loading-state'
import type { useDisplayedShell } from '@/features/workspace/hooks/use-displayed-shell'

/** The displayed shell, or its first load. */
export function ShellBody({
  query,
  rootPath,
}: {
  readonly query: ReturnType<typeof useDisplayedShell>['query']
  readonly rootPath: FilesystemPath
}) {
  if (query.isPending)
    return (
      <LoadingState label='Opening workspace' className='flex h-full flex-col gap-3 p-6'>
        <div className='skeleton-sweep h-4 w-48 rounded-md' />
        <div className='skeleton-sweep h-4 w-32 rounded-md' />
      </LoadingState>
    )
  if (query.isError)
    return (
      <ModuleLoadError className='h-full' label='workspace' onRetry={() => void query.refetch()} />
    )

  const Shell = query.data
  return <Shell rootPath={rootPath} />
}
