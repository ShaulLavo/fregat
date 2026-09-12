import { and, eq, isNull, or } from 'drizzle-orm'
import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  OrchestrationSessionShell,
  OrchestrationShellSnapshot,
} from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import {
  projectionProjects,
  projectionWorktrees,
  projectionSessions,
  projectionSessionRuntime,
} from '../db/schema'
import type { OrchestrationSnapshotQuery } from './snapshot-query'
import {
  projectShellFromRow,
  worktreeShellFromRow,
  sessionShellFromRow,
} from './utils/projection-rows'

export type OrchestrationShellRowReader = {
  beginWindow: () => void
  projectShell: (projectId: string) => OrchestrationProjectShell | null
  worktreeShell: (worktreeId: string) => OrchestrationWorktreeShell | null
  sessionShell: (sessionId: string) => OrchestrationSessionShell | null
}

export function createShellRowReader(
  snapshots: OrchestrationSnapshotQuery,
  database?: PlatformDatabase,
): OrchestrationShellRowReader {
  if (database) return new ProjectionShellRowReader(database)
  return new SnapshotShellRowReader(snapshots)
}

export class ProjectionShellRowReader implements OrchestrationShellRowReader {
  private readonly database: PlatformDatabase

  constructor(database: PlatformDatabase) {
    this.database = database
  }

  beginWindow() {}

  projectShell(projectId: string) {
    const row = this.database
      .select()
      .from(projectionProjects)
      .where(and(eq(projectionProjects.projectId, projectId), isNull(projectionProjects.deletedAt)))
      .get()
    return row ? projectShellFromRow(row) : null
  }

  worktreeShell(worktreeId: string) {
    const row = this.database
      .select({ worktree: projectionWorktrees })
      .from(projectionWorktrees)
      .innerJoin(
        projectionProjects,
        eq(projectionProjects.projectId, projectionWorktrees.projectId),
      )
      .where(
        and(
          eq(projectionWorktrees.worktreeId, worktreeId),
          isNull(projectionProjects.deletedAt),
          or(
            isNull(projectionWorktrees.retiredAt),
            eq(projectionWorktrees.lifecycleState, 'removed'),
          ),
        ),
      )
      .get()
    return row ? worktreeShellFromRow(row.worktree) : null
  }

  sessionShell(sessionId: string) {
    const row = this.database
      .select()
      .from(projectionSessions)
      .where(and(eq(projectionSessions.sessionId, sessionId), isNull(projectionSessions.deletedAt)))
      .get()
    if (!row) return null
    const runtime = this.database
      .select()
      .from(projectionSessionRuntime)
      .where(eq(projectionSessionRuntime.sessionId, sessionId))
      .get()
    return sessionShellFromRow(row, runtime)
  }
}

class SnapshotShellRowReader implements OrchestrationShellRowReader {
  private window: OrchestrationShellSnapshot | null = null

  private readonly snapshots: OrchestrationSnapshotQuery

  constructor(snapshots: OrchestrationSnapshotQuery) {
    this.snapshots = snapshots
  }

  beginWindow() {
    this.window = null
  }

  projectShell(projectId: string) {
    return this.snapshot().projects.find((project) => project.id === projectId) ?? null
  }

  worktreeShell(worktreeId: string) {
    return this.snapshot().worktrees.find((worktree) => worktree.id === worktreeId) ?? null
  }

  sessionShell(sessionId: string) {
    return this.snapshot().sessions.find((session) => session.id === sessionId) ?? null
  }

  private snapshot() {
    this.window ??= this.snapshots.shellSnapshot()
    return this.window
  }
}
