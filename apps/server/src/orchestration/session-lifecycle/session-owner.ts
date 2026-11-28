import type { OrchestrationReadModel } from '../read-model'
import { requireProject, requireSession, requireWorktree } from '../read-model'
import { eq } from 'drizzle-orm'
import { projectionProjects, projectionSessions, projectionWorktrees } from '../../db/schema'
import type { OrchestrationDatabase } from '../event-store'
import { orchestrationErrors } from '../../observability'

export function resolveSessionOwner(model: OrchestrationReadModel, sessionId: string) {
  const session = requireSession(model, sessionId)
  const worktree = requireWorktree(model, session.worktreeId)
  const project = requireProject(model, worktree.projectId)
  return { session, worktree, project }
}

export function readSessionOwner(database: OrchestrationDatabase, sessionId: string) {
  const row = database
    .select({
      session: projectionSessions,
      worktree: projectionWorktrees,
      project: projectionProjects,
    })
    .from(projectionSessions)
    .innerJoin(
      projectionWorktrees,
      eq(projectionWorktrees.worktreeId, projectionSessions.worktreeId),
    )
    .innerJoin(projectionProjects, eq(projectionProjects.projectId, projectionWorktrees.projectId))
    .where(eq(projectionSessions.sessionId, sessionId))
    .get()
  if (!row || row.session.deletedAt || row.worktree.retiredAt || row.project.deletedAt) {
    throw orchestrationErrors.SESSION_NOT_FOUND({ sessionId })
  }
  return row
}
