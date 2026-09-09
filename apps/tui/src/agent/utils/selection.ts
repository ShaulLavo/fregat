import type { ProjectId } from '@workspace/contracts'
import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'
import type { AgentLocation, StageTarget } from '@/agent/utils/target'

export function currentWorktree(projection: ChatProjectionSlice, projectId: ProjectId | null) {
  const candidates = projection.worktreeIds
    .map((id) => projection.worktreeById[id])
    .filter((worktree) => worktree.projectId === projectId && worktree.lifecycle.state === 'ready')
  return candidates.find((worktree) => worktree.kind === 'current') ?? candidates[0] ?? null
}

export function selectedProject(projection: ChatProjectionSlice, location: AgentLocation) {
  const session = location.sessionId ? projection.sessionById[location.sessionId] : null
  if (session) return projection.worktreeById[session.worktreeId]?.projectId ?? null
  const worktree = location.worktreeId ? projection.worktreeById[location.worktreeId] : null
  if (worktree) return worktree.projectId
  if (location.projectId && projection.projectById[location.projectId]) return location.projectId
  return projection.projectIds[0] ?? null
}

export function selectedWorktree(projection: ChatProjectionSlice, location: AgentLocation) {
  if (location.sessionId) {
    const session = projection.sessionById[location.sessionId]
    return session ? (projection.worktreeById[session.worktreeId] ?? null) : null
  }
  if (location.worktreeId) return projection.worktreeById[location.worktreeId] ?? null
  return currentWorktree(projection, selectedProject(projection, location))
}

export function stageTarget(
  projection: ChatProjectionSlice,
  location: AgentLocation,
): StageTarget | null {
  if (location.sessionId)
    return projection.sessionById[location.sessionId]
      ? { kind: 'conversation', sessionId: location.sessionId }
      : null
  const worktree = selectedWorktree(projection, location)
  return worktree ? { kind: 'draft', worktreeId: worktree.id } : null
}
