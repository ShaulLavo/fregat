import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'

export function ModuleLoadError({
  label,
  className,
  onRetry,
}: {
  label: string
  className?: string
  onRetry: () => void
}) {
  return (
    <ToolPane
      className={className}
      header={null}
      state={{ error: true }}
      errorState={
        <EmptyState
          title={`Unable to load ${label}`}
          tone='error'
          action={
            <div className='flex gap-(--density-gap-tight)'>
              <Button size='sm' variant='outline' onClick={onRetry}>
                Retry
              </Button>
              <Button size='sm' variant='outline' onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          }
        />
      }
    />
  )
}
