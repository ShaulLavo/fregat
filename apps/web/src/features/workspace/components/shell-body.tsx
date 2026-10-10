import { ModuleLoadError } from '@/components/module-load-error'
import { LoadingState } from '@workspace/ui/components/loading-state'
import type { useDisplayedShell } from '@/features/workspace/hooks/use-displayed-shell'
import type { ShellProps } from '@/lib/shell/utils/props'

/** The displayed shell, or its first load. */
export function ShellBody({
  children,
  query,
  rootPath,
}: ShellProps & {
  readonly query: ReturnType<typeof useDisplayedShell>['query']
}) {
  if (query.isPending)
    return (
      <LoadingState
        label='Opening workspace'
        className='flex h-full flex-col gap-(--density-section-gap) p-(--density-section-padding)'
      >
        <div className='skeleton-sweep h-4 w-48 rounded-md' />
        <div className='skeleton-sweep h-4 w-32 rounded-md' />
      </LoadingState>
    )
  if (query.isError)
    return (
      <ModuleLoadError className='h-full' label='workspace' onRetry={() => void query.refetch()} />
    )

  const Shell = query.data
  return <Shell rootPath={rootPath}>{children}</Shell>
}
