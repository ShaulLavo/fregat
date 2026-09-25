import type { ScopedProjectRef } from '@workspace/contracts'
import type { SessionRailEnvironment } from '@workspace/client-core/chat/rail/model'
import {
  projectGroups,
  type ProjectGroupingSettings,
} from '@workspace/client-core/chat/rail/project-grouping'

/**
 * Every connected machine's checkout of the draft's repository, the draft's own
 * machine included. A machine appears only once its projection has the project.
 */
export function draftMachines(
  environments: readonly SessionRailEnvironment[],
  settings: ProjectGroupingSettings,
  ref: ScopedProjectRef,
) {
  const group = projectGroups(environments, settings).find((candidate) =>
    candidate.members.some(
      (member) =>
        member.ref.environmentId === ref.environmentId && member.ref.projectId === ref.projectId,
    ),
  )
  if (!group) return []

  return group.members.flatMap((member) => {
    const environment = environments.find(
      (candidate) => candidate.environmentId === member.ref.environmentId,
    )
    if (!environment) return []
    const checkout = environment.worktrees.find(
      (worktree) =>
        worktree.projectId === member.ref.projectId &&
        worktree.kind === 'current' &&
        worktree.lifecycle.state === 'ready',
    )
    return [
      {
        environmentId: member.ref.environmentId,
        projectId: member.ref.projectId,
        label: member.label,
        phase: environment.phase,
        worktree: checkout ? { id: checkout.id, path: checkout.path } : null,
      },
    ]
  })
}
