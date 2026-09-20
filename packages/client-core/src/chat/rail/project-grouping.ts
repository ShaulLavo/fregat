import {
  scopedProjectKey,
  type ScopedProjectRef,
  type SettingsValues,
  type RepositoryIdentity,
} from '@workspace/contracts'
import type { SessionRailEnvironment } from './model'

export type ProjectGroupingSettings = {
  readonly mode: SettingsValues['chat.projectGrouping']
  readonly overrides: SettingsValues['chat.projectGroupingOverrides']
}
export type ProjectGroupMember = {
  readonly ref: ScopedProjectRef
  readonly physicalKey: string
  readonly project: SessionRailEnvironment['projects'][number]
  readonly workspaceRoot: string
  readonly label: string
  readonly available: boolean
  readonly primary: boolean
}
export type ProjectGroup = {
  readonly key: string
  readonly members: readonly ProjectGroupMember[]
  readonly representative: ProjectGroupMember
}

export function projectGroups(
  environments: readonly SessionRailEnvironment[],
  settings: ProjectGroupingSettings,
): readonly ProjectGroup[] {
  const groups = new Map<string, ProjectGroupMember[]>()
  for (const environment of environments) {
    for (const project of environment.projects) {
      const worktree = environment.worktrees.find(
        (candidate) => candidate.projectId === project.id && candidate.kind === 'current',
      )
      if (!worktree) continue
      const ref = { environmentId: environment.environmentId, projectId: project.id }
      const member: ProjectGroupMember = {
        ref,
        physicalKey: scopedProjectKey(ref),
        project,
        workspaceRoot: worktree.path,
        label: environment.label ?? environment.environmentId,
        available: environment.phase === 'live',
        primary: environment.isPrimary,
      }
      const key = deriveProjectGroupKey(ref, project.repositoryIdentity, settings)
      const members = groups.get(key) ?? []
      members.push(member)
      groups.set(key, members)
    }
  }
  return Array.from(groups, ([key, members]) => {
    const ordered = members.toSorted(
      (left, right) =>
        Number(right.primary) - Number(left.primary) ||
        left.physicalKey.localeCompare(right.physicalKey),
    )
    return { key, members: ordered, representative: ordered[0]! }
  })
}

export function deriveProjectGroupKey(
  ref: ScopedProjectRef,
  identity: RepositoryIdentity,
  settings: ProjectGroupingSettings,
) {
  const physicalKey = scopedProjectKey(ref)
  const mode = settings.overrides[physicalKey] ?? settings.mode
  // Git registration always chooses the checkout root: its relative project
  // path is empty, so both repository modes currently produce the same group.
  return mode === 'separate' || identity.source === 'path'
    ? `physical:${physicalKey}`
    : `repository:${identity.source}:${identity.canonical}`
}
