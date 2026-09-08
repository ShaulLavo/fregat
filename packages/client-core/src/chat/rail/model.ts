import {
  scopedSessionKey,
  scopedProjectKey,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationWorktreeShell,
  type OrchestrationSessionSearchMatch,
  type ProjectId,
  type ScopedProjectRef,
  type ScopedSessionRef,
  type SessionId,
  type SessionAttentionState,
  type SessionAttentionReason,
} from '@workspace/contracts'
import type { ChatSessionListProjection } from '@workspace/client-core/chat/selectors'
import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { compareProjectsForRail } from '@workspace/client-core/chat/rail/project-order'
import { compareSessionsForRail } from '@workspace/client-core/chat/rail/session-order'
import {
  isSessionUnread,
  sessionCompletedAt,
  type SessionSeenStamps,
} from '@workspace/client-core/chat/rail/unread'

export type SessionRailScope = ProjectId | null
export type SessionRailView = 'active' | 'archived'
export type SessionRailEnvironment = {
  readonly environmentId: EnvironmentId
  readonly label: string | null
  readonly isPrimary: boolean
  readonly phase: EnvironmentPhase
  readonly projects: readonly OrchestrationProjectShell[]
  readonly worktrees: readonly OrchestrationWorktreeShell[]
  readonly sessions: readonly ChatSessionListProjection[]
}
export type SessionRailItem = {
  readonly ref: ScopedSessionRef
  readonly key: string
  readonly environmentId: EnvironmentId
  readonly machineLabel: string | null
  readonly stale: boolean
  readonly projectGroupKey: ProjectId
  readonly activityAt: string
  readonly origin: ChatSessionListProjection['origin']
  readonly archived: boolean
  readonly branch: string | null
  readonly createdAt: string
  readonly id: SessionId
  readonly pinOrderKey: string | null
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly status: SessionAttentionState
  readonly attentionReason: SessionAttentionReason | null
  readonly hasError: boolean
  readonly title: string
  readonly unread: boolean
  readonly worktree: OrchestrationWorktreeShell
  readonly repositoryKind: OrchestrationProjectShell['repositoryKind']
  readonly worktreePath: string
}
export type SessionRailProject = {
  readonly ref: ScopedProjectRef
  readonly key: string
  readonly active: boolean
  readonly id: ProjectId
  readonly orderKey: string | null
  readonly createdAt: string
  readonly sessionCount: number
  readonly status: SessionAttentionState
  readonly title: string
  readonly qualifier: string | null
  readonly unreadCount: number
  readonly workspaceRoot: string
}
export type SessionRailGroup = {
  readonly key: string
  readonly collapsed: boolean
  readonly hiddenCount: number
  readonly project: SessionRailProject
  readonly sessions: readonly SessionRailItem[]
}
export type SessionRailSection = {
  readonly state: SessionAttentionState
  readonly title: string
  readonly groups: readonly SessionRailGroup[]
}
export type SessionRailModel = {
  readonly archivedCount: number
  readonly sections: readonly SessionRailSection[]
  readonly groups: readonly SessionRailGroup[]
  readonly projects: readonly SessionRailProject[]
  readonly sessions: readonly SessionRailItem[]
  readonly scopedCount: number
  readonly scopeTitle: string
}
export type SessionSearchMatches = Readonly<Record<string, OrchestrationSessionSearchMatch>>
export type RailOrderOverrides = {
  readonly projectOrderKeys: Readonly<Record<string, string>>
  readonly sessionOrderKeys: Readonly<Record<string, string>>
}
const SECTIONS = [
  { state: 'needs-input', title: 'Needs input' },
  { state: 'working', title: 'Working' },
  { state: 'settled', title: 'Settled' },
] as const

export function sessionRailModel({
  environments,
  activeProjectId = null,
  activeSessionKey = null,
  collapsedProjectIds = [],
  orderOverrides = { projectOrderKeys: {}, sessionOrderKeys: {} },
  query = '',
  scope = null,
  machineFilter = null,
  searchMatches = {},
  seenBySessionKey = {},
  view = 'active',
}: {
  readonly environments: readonly SessionRailEnvironment[]
  readonly activeProjectId?: ProjectId | null
  readonly activeSessionKey?: string | null
  readonly collapsedProjectIds?: readonly ProjectId[]
  readonly orderOverrides?: RailOrderOverrides
  readonly query?: string
  readonly scope?: SessionRailScope
  readonly machineFilter?: EnvironmentId | null
  readonly searchMatches?: SessionSearchMatches
  readonly seenBySessionKey?: SessionSeenStamps
  readonly view?: SessionRailView
}): SessionRailModel {
  const visibleEnvironments =
    machineFilter === null
      ? environments
      : environments.filter((environment) => environment.environmentId === machineFilter)
  const allItems = environments.flatMap((environment) =>
    environment.sessions.map((session) => {
      const ref = { environmentId: environment.environmentId, sessionId: session.id }
      const key = scopedSessionKey(ref)
      return sessionRailItem(
        session,
        ref.environmentId,
        !environment.isPrimary || environments.length > 1
          ? (environment.label ?? environment.environmentId)
          : null,
        seenBySessionKey[key],
        orderOverrides.sessionOrderKeys[key],
        environment.phase !== 'live',
      )
    }),
  )
  const items = allItems
    .filter((item) => machineFilter === null || item.environmentId === machineFilter)
    .filter((item) =>
      view === 'archived' ? item.archived : !item.archived || item.status === 'needs-input',
    )
    .toSorted(compareSessionsForRail)
  const scoped = scope ? items.filter((item) => item.projectGroupKey === scope) : items
  const needle = query.trim().toLowerCase()
  const matching = scoped.filter(
    (item) =>
      !needle ||
      `${item.title}
${item.projectTitle}
${item.branch ?? ''}
${item.machineLabel ?? ''}`
        .toLowerCase()
        .includes(needle) ||
      Boolean(searchMatches[item.key]),
  )
  const projectsById = new Map<ProjectId, SessionRailProject>()
  for (const environment of visibleEnvironments) {
    for (const project of environment.projects) {
      if (projectsById.has(project.id)) continue
      const worktree = environment.worktrees.find(
        (worktree) => worktree.projectId === project.id && worktree.kind === 'current',
      )
      if (!worktree) continue
      const ref = { environmentId: environment.environmentId, projectId: project.id }
      const key = scopedProjectKey(ref)
      const owned = items.filter((item) => item.projectGroupKey === project.id)
      projectsById.set(
        project.id,
        railProject(
          project,
          ref,
          key,
          worktree.path,
          owned,
          project.id === activeProjectId,
          orderOverrides.projectOrderKeys[key],
        ),
      )
    }
  }
  const projects = [...projectsById.values()].toSorted(compareProjectsForRail)
  const sections = SECTIONS.map((section) => ({
    ...section,
    groups: projects.flatMap((project) => {
      const owned = matching.filter(
        (item) => item.projectGroupKey === project.id && item.status === section.state,
      )
      if (!owned.length) return []
      const collapsed = !needle && collapsedProjectIds.includes(project.id)
      const visible = collapsed ? owned.filter((item) => item.key === activeSessionKey) : owned
      return [
        {
          key: `${section.state}:${project.id}`,
          collapsed,
          hiddenCount: owned.length - visible.length,
          project: {
            ...project,
            status: section.state,
            sessionCount: owned.length,
            unreadCount: owned.filter((session) => session.unread).length,
          },
          sessions: visible,
        },
      ]
    }),
  }))
  const groups = sections.flatMap((section) => section.groups)
  return {
    archivedCount: allItems.filter((item) => item.archived).length,
    sections,
    groups,
    projects,
    sessions: sections.flatMap((section) =>
      matching.filter((item) => item.status === section.state),
    ),
    scopedCount: scoped.length,
    scopeTitle: scope ? (projectsById.get(scope)?.title ?? 'Project') : 'All projects',
  }
}

export function sessionRailItem(
  session: ChatSessionListProjection,
  environmentId: EnvironmentId,
  machineLabel: string | null = null,
  seenAt?: string,
  pendingOrderKey?: string,
  stale = false,
): SessionRailItem {
  const ref = { environmentId, sessionId: session.id }
  return {
    ref,
    key: scopedSessionKey(ref),
    environmentId,
    machineLabel,
    stale,
    projectGroupKey: session.project.id,
    activityAt: session.activityAt,
    origin: session.origin,
    archived: Boolean(session.archivedAt),
    branch: session.worktree.branch,
    createdAt: session.createdAt,
    id: session.id,
    pinOrderKey: pendingOrderKey ?? session.pinOrderKey,
    projectId: session.project.id,
    projectTitle: session.project.title,
    status: session.attentionState,
    attentionReason: session.attentionReason,
    hasError: session.hasError,
    title: session.title,
    unread: isSessionUnread(sessionCompletedAt(session), seenAt),
    worktree: session.worktree,
    repositoryKind: session.project.repositoryKind,
    worktreePath: session.worktree.path,
  }
}
function railProject(
  project: OrchestrationProjectShell,
  ref: ScopedProjectRef,
  key: string,
  workspaceRoot: string,
  sessions: readonly SessionRailItem[],
  active: boolean,
  pendingOrderKey?: string,
): SessionRailProject {
  const status =
    SECTIONS.find((section) => sessions.some((session) => session.status === section.state))
      ?.state ?? 'settled'
  return {
    ref,
    key,
    active,
    id: project.id,
    createdAt: project.createdAt,
    orderKey: pendingOrderKey ?? project.orderKey,
    sessionCount: sessions.length,
    status,
    title: project.title,
    qualifier: null,
    unreadCount: sessions.filter((session) => session.unread).length,
    workspaceRoot,
  }
}
