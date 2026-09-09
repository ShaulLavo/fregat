import type { OrchestrationProjectShell, OrchestrationWorktreeShell } from '@workspace/contracts'
import { OrbitLoader } from '@/components/orbit-loader'
import type { Theme } from '@/theme/utils/theme'
import { worktreeSummary } from '@/worktrees/utils/summary'

export function WorktreeChip({
  worktree,
  repositoryKind,
  theme,
}: {
  readonly worktree: OrchestrationWorktreeShell
  readonly repositoryKind: OrchestrationProjectShell['repositoryKind']
  readonly theme: Theme
}) {
  const state = worktree.lifecycle.state
  const pending = state === 'provisioning' || state === 'cleanup-requested'
  const failed = state === 'creation-failed' || state === 'cleanup-failed' || state === 'missing'
  let color = theme.mutedForeground
  if (pending) color = theme.info
  if (failed) color = theme.destructive
  if (state === 'cleanup-blocked') color = theme.warning
  return (
    <box flexDirection='row' height={1} flexShrink={0} minWidth={0} overflow='hidden' gap={1}>
      {pending && <OrbitLoader theme={theme} />}
      <text fg={color} wrapMode='none'>
        {worktreeSummary(worktree, repositoryKind)}
      </text>
    </box>
  )
}
