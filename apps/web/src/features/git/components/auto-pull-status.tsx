import { cn } from '@workspace/ui/lib/utils'

import { useStatus } from '@/features/git/hooks/use-status'
import { autoPullLabel } from '@/features/git/utils/auto-pull-label'

/** One quiet line while automatic default-branch pull is on and cannot run. */
export function AutoPullStatus({ rootPath }: { readonly rootPath: string }) {
  const state = useStatus(rootPath).data?.autoPull ?? null
  const label = autoPullLabel(state)
  if (!label) return null

  return (
    <p
      className={cn(
        'px-(--bar-padding-x) pt-2 text-xs truncate',
        state?.state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
      title={label}
    >
      {label}
    </p>
  )
}
