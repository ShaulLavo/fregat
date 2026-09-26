import { effectiveSnoozed } from './snooze'
import {
  sessionRailStatus,
  type HealthDescriptor,
  type SessionRailStatus,
} from '@workspace/contracts'
import {
  projectGroups,
  type ProjectGroupMember,
  type ProjectGroupingSettings,
} from './project-grouping'
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
  type SessionAttentionReason,
} from '@workspace/contracts'
import type { ChatSessionListProjection } from '@workspace/client-core/chat/selectors'
import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { compareProjectsForRail } from '@workspace/client-core/chat/rail/project-order'
import {
  comparePinnedSessions,
  compareActiveSessions,
  compareSettledSessions,
} from '@workspace/client-core/chat/rail/session-order'
import {
  isSessionUnread,
  sessionCompletedAt,
  type SessionSeenStamps,
} from '@workspace/client-core/chat/rail/unread'

export type SessionRailPlacement = 'pinned' | 'active' | 'snoozed' | 'settled'
export type SessionRailScope = string | null
export type SessionRailView = 'active' | 'archived'
export type SessionRailEnvironment = {
  readonly capabilities?: HealthDescriptor['capabilities']
  readonly environmentId: EnvironmentId
  readonly label: string | null
  readonly isPrimary: boolean
  readonly phase: EnvironmentPhase
  readonly projects: readonly OrchestrationProjectShell[]
  readonly worktrees: readonly OrchestrationWorktreeShell[]
  readonly sessions: readonly ChatSessionListProjection[]
}
export type SessionRailItem = {
  readonly placement: SessionRailPlacement
  readonly canDrag: boolean
  readonly canReorder: boolean
  readonly settledAt: string | null
  readonly settledOrderAt: string | null
  readonly activeOrderKey: string | null
  readonly unsettledAt: string | null
  readonly pinnedAt: string | null
  readonly settledOverride: ChatSessionListProjection['settledOverride']
  readonly snoozedAt: string | null
  readonly snoozedUntil: string | null
  readonly ref: ScopedSessionRef
  readonly key: string
  readonly environmentId: EnvironmentId
  readonly machineLabel: string | null
  readonly stale: boolean
  readonly projectGroupKey: string
  readonly activityAt: string
  readonly origin: ChatSessionListProjection['origin']
  readonly archived: boolean
  readonly branch: string | null
  readonly createdAt: string
  readonly id: SessionId
  readonly pinOrderKey: string | null
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly status: SessionRailStatus
  readonly attentionReason: SessionAttentionReason | null
  readonly hasError: boolean
  readonly title: string
  readonly unread: boolean
  readonly worktree: OrchestrationWorktreeShell
  readonly repositoryKind: OrchestrationProjectShell['repositoryKind']
  readonly worktreePath: string
}
export type SessionRailProject = {
  readonly groupKey: string
  readonly members: readonly ProjectGroupMember[]
  readonly sessionRefs: readonly ScopedSessionRef[]
  readonly ref: ScopedProjectRef
  readonly key: string
  readonly active: boolean
  readonly id: ProjectId
  readonly orderKey: string | null
  readonly createdAt: string
  readonly sessionCount: number
  readonly status: SessionRailStatus
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
  readonly state: SessionRailPlacement
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
export type SessionLifecycleOverride = Partial<
  Pick<
    ChatSessionListProjection,
    | 'pinnedAt'
    | 'settledOverride'
    | 'settledAt'
    | 'snoozedUntil'
    | 'snoozedAt'
    | 'activeOrderKey'
    | 'unsettledAt'
    | 'pinOrderKey'
  >
>
export type RailOrderOverrides = {
  readonly sessionLifecycleByKey?: Readonly<Record<string, SessionLifecycleOverride>>
  readonly projectOrderKeys: Readonly<Record<string, string>>
}
const SECTIONS = [
  { state: 'pinned', title: 'Pinned' },
  { state: 'active', title: 'Active' },
  { state: 'snoozed', title: 'Snoozed' },
  { state: 'settled', title: 'Settled' },
] as const

export function sessionRailModel({
  environments,
  activeProjectRef = null,
  activeSessionKey = null,
  collapsedProjectIds = [],
  orderOverrides = { projectOrderKeys: {} },
  query = '',
  scope = null,
  machineFilter = null,
  searchMatches = {},
  seenBySessionKey = {},
  view = 'active',
  grouping = { mode: 'repository', overrides: {} },
  now = Date.now(),
}: {
  readonly now?: number
  readonly environments: readonly SessionRailEnvironment[]
  readonly grouping?: ProjectGroupingSettings
  readonly activeProjectRef?: ScopedProjectRef | null
  readonly activeSessionKey?: string | null
  readonly collapsedProjectIds?: readonly string[]
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
  const logicalGroups = projectGroups(visibleEnvironments, grouping)
  const groupKeyByMember = new Map(
    logicalGroups.flatMap((group) =>
      group.members.map((member) => [member.physicalKey, group.key] as const),
    ),
  )
  const allItems = environments.flatMap((environment) =>
    environment.sessions.map((session) => {
      const ref = { environmentId: environment.environmentId, sessionId: session.id }
      const key = scopedSessionKey(ref)
      const item = sessionRailItem(
        { ...session, ...orderOverrides.sessionLifecycleByKey?.[key] },
        ref.environmentId,
        !environment.isPrimary || environments.length > 1
          ? (environment.label ?? environment.environmentId)
          : null,
        seenBySessionKey[key],
        environment.phase !== 'live',
        environment.capabilities,
        now,
      )
      return {
        ...item,
        projectGroupKey:
          groupKeyByMember.get(
            scopedProjectKey({
              environmentId: environment.environmentId,
              projectId: session.project.id,
            }),
          ) ?? item.projectGroupKey,
      }
    }),
  )
  const items = allItems
    .filter((item) => machineFilter === null || item.environmentId === machineFilter)
    .filter((item) => (view === 'archived' ? item.archived : !item.archived))
    .toSorted(compareRailItems)
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
  const projectsById = new Map<string, SessionRailProject>()
  for (const group of logicalGroups) {
    const owned = items.filter((item) => item.projectGroupKey === group.key)
    const displayed = matching.filter((item) => item.projectGroupKey === group.key)
    const displayedMembers = needle
      ? group.members.filter((member) =>
          displayed.some(
            (item) =>
              item.environmentId === member.ref.environmentId &&
              item.projectId === member.ref.projectId,
          ),
        )
      : group.members
    const representative = displayedMembers[0] ?? group.representative
    projectsById.set(group.key, {
      ...railProject(
        representative.project,
        representative.ref,
        representative.physicalKey,
        representative.workspaceRoot,
        owned,
        group.members.some(
          (member) =>
            member.ref.projectId === activeProjectRef?.projectId &&
            member.ref.environmentId === activeProjectRef.environmentId,
        ),
        orderOverrides.projectOrderKeys[representative.physicalKey],
      ),
      groupKey: group.key,
      members: displayedMembers,
      sessionRefs: displayed.filter((item) => !item.archived).map((item) => item.ref),
      qualifier:
        displayedMembers.length > 1 ? `${displayedMembers.length} machines` : representative.label,
    })
  }
  const projects = [...projectsById.values()].toSorted(compareProjectsForRail)
  const sections = SECTIONS.map((section) => ({
    ...section,
    groups: projects.flatMap((project) => {
      const owned = matching.filter(
        (item) => item.projectGroupKey === project.groupKey && item.placement === section.state,
      )
      if (!owned.length) return []
      const collapsed =
        !needle &&
        project.members.length > 0 &&
        project.members.every((member) => collapsedProjectIds.includes(member.physicalKey))
      const visible = collapsed ? owned.filter((item) => item.key === activeSessionKey) : owned
      return [
        {
          key: `${section.state}:${project.groupKey}`,
          collapsed,
          hiddenCount: owned.length - visible.length,
          project: {
            ...project,
            status: railStatus(owned),
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
      matching.filter((item) => item.placement === section.state),
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
  stale = false,
  capabilities?: HealthDescriptor['capabilities'],
  now = Date.now(),
): SessionRailItem {
  const ref = { environmentId, sessionId: session.id }
  const placement = sessionPlacement(session, capabilities, now)
  return {
    placement,
    canDrag:
      !stale &&
      !session.archivedAt &&
      Boolean(
        capabilities?.sessionPinning ||
        capabilities?.sessionSettlement ||
        capabilities?.sessionActiveReorder,
      ),
    canReorder:
      !stale &&
      ((placement === 'pinned' &&
        capabilities?.sessionPinning === true &&
        capabilities.sessionPinReorder === true) ||
        (placement === 'active' && capabilities?.sessionActiveReorder === true)),
    settledAt: session.settledAt ?? null,
    settledOrderAt: session.settledAt ?? session.settledOrderAt ?? null,
    activeOrderKey: session.activeOrderKey ?? null,
    unsettledAt: session.unsettledAt ?? null,
    pinnedAt: session.pinnedAt ?? null,
    settledOverride: session.settledOverride,
    snoozedAt: session.snoozedAt ?? null,
    snoozedUntil: session.snoozedUntil ?? null,
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
    pinOrderKey: session.pinOrderKey,
    projectId: session.project.id,
    projectTitle: session.project.title,
    status: sessionRailStatus(session),
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
): Omit<SessionRailProject, 'groupKey' | 'members' | 'sessionRefs'> {
  const status = railStatus(sessions)
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

function railStatus(sessions: readonly SessionRailItem[]): SessionRailStatus {
  for (const status of [
    'approval',
    'input',
    'working',
    'monitoring',
    'failed',
    'sleeping',
  ] as const) {
    if (sessions.some((session) => session.status === status)) return status
  }
  return 'ready'
}

function sessionPlacement(
  session: ChatSessionListProjection,
  capabilities: HealthDescriptor['capabilities'],
  now: number,
): SessionRailPlacement {
  if (capabilities?.sessionSnooze && effectiveSnoozed(session, now)) return 'snoozed'
  if (capabilities?.sessionSettlement && session.settledOverride === 'settled') return 'settled'
  return session.pinnedAt ? 'pinned' : 'active'
}

function compareRailItems(left: SessionRailItem, right: SessionRailItem) {
  const shelfOrder =
    SECTIONS.findIndex((shelf) => shelf.state === left.placement) -
    SECTIONS.findIndex((shelf) => shelf.state === right.placement)
  if (shelfOrder) return shelfOrder
  if (left.placement === 'snoozed')
    return (
      Date.parse(left.snoozedUntil!) - Date.parse(right.snoozedUntil!) ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId)
    )
  if (left.placement === 'settled')
    return compareSettledSessions(
      { ...left, settledAt: left.settledOrderAt, updatedAt: left.activityAt },
      { ...right, settledAt: right.settledOrderAt, updatedAt: right.activityAt },
    )
  if (left.placement === 'pinned') return comparePinnedSessions(left, right)
  return compareActiveSessions(left, right)
}
