import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import {
  worktreeLifecycleSchema,
  type OrchestrationEvent,
  type WorktreeLifecycle,
  type SessionDeletionState,
} from '@workspace/contracts'
import type { PlatformDatabase } from '../db/client'
import {
  projectionProjects,
  projectionSessions,
  projectionTerminalLeases,
  projectionWorktrees,
} from '../db/schema'
import { worktreeCleanupEligibility, worktreeCreationCapability } from './utils/worktree-policy'

export function applyWorktreeEvent(database: PlatformDatabase, event: OrchestrationEvent) {
  switch (event.type) {
    case 'worktree.create-requested':
      provision(database, event)
      return true
    case 'worktree.orphan-registered':
      orphan(database, event)
      return true
    case 'worktree.created':
      update(database, event.payload.worktreeId, {
        headCommit: event.payload.headCommit,
        updatedAt: event.payload.updatedAt,
        ...lifecycleFields({ state: 'ready' }),
      })
      return true
    case 'worktree.creation-failed':
      updateLifecycle(database, event.payload, {
        state: 'creation-failed',
        operationId: event.payload.operationId,
        errorCode: event.payload.errorCode,
      })
      return true
    case 'worktree.cleanup-requested':
      updateLifecycle(database, event.payload, { ...event.payload, state: 'cleanup-requested' })
      return true
    case 'worktree.cleanup-blocked':
      updateLifecycle(database, event.payload, {
        state: 'cleanup-blocked',
        operationId: event.payload.operationId,
        reason: event.payload.reason,
        changedFileCount: event.payload.changedFileCount,
      })
      return true
    case 'worktree.cleanup-failed':
      updateLifecycle(database, event.payload, {
        state: 'cleanup-failed',
        operationId: event.payload.operationId,
        errorCode: event.payload.errorCode,
      })
      return true
    case 'worktree.removed':
      update(database, event.payload.worktreeId, {
        ...lifecycleFields({
          state: 'removed',
          operationId: event.payload.operationId,
          removedAt: event.payload.removedAt,
        }),
        operationId: event.payload.operationId,
        removedAt: event.payload.removedAt,
        retiredAt: event.payload.removedAt,
        retirementSequence: event.sequence,
        updatedAt: event.payload.updatedAt,
      })
      return true
    case 'worktree.missing':
      updateLifecycle(database, event.payload, { state: 'missing' })
      return true
    case 'worktree.adopted':
      update(database, event.payload.worktreeId, {
        ownership: 'platform',
        baseCommit: event.payload.headCommit,
        headCommit: event.payload.headCommit,
        branch: event.payload.branch,
        ...lifecycleFields({ state: 'ready' }),
        updatedAt: event.payload.updatedAt,
      })
      return true
    case 'worktree.retained':
      updateLifecycle(database, event.payload, { state: 'ready' })
      return true
    case 'worktree.released':
      update(database, event.payload.worktreeId, {
        ownership: 'external',
        updatedAt: event.payload.updatedAt,
      })
      return true
    case 'worktree.metadata-refreshed':
      update(database, event.payload.worktreeId, {
        branch: event.payload.branch,
        headCommit: event.payload.headCommit,
        metadataVersion: event.payload.metadataVersion,
        updatedAt: event.payload.updatedAt,
      })
      return true
    case 'terminal.lease-updated':
      database
        .insert(projectionTerminalLeases)
        .values(event.payload)
        .onConflictDoUpdate({
          target: projectionTerminalLeases.terminalLeaseId,
          set: event.payload,
        })
        .run()
      refreshTerminalCounts(database, event.payload.worktreeId)
      return true
    default:
      return false
  }
}

function provision(
  database: PlatformDatabase,
  event: Extract<OrchestrationEvent, { type: 'worktree.create-requested' }>,
) {
  const payload = event.payload
  const row = {
    ...payload,
    registrationGeneration: 0,
    kind: 'linked' as const,
    ownership: 'platform' as const,
    pathKind: 'id-derived' as const,
    ...lifecycleFields({
      state: 'provisioning',
      operationId: payload.operationId,
      baseCommit: payload.baseCommit,
      branch: payload.branch,
    }),
  }
  database
    .insert(projectionWorktrees)
    .values(row)
    .onConflictDoUpdate({
      target: projectionWorktrees.worktreeId,
      set: {
        ...lifecycleFields({
          state: 'provisioning',
          operationId: payload.operationId,
          baseCommit: payload.baseCommit,
          branch: payload.branch,
        }),
        operationId: payload.operationId,
        updatedAt: payload.updatedAt,
      },
    })
    .run()
}

function orphan(
  database: PlatformDatabase,
  event: Extract<OrchestrationEvent, { type: 'worktree.orphan-registered' }>,
) {
  const payload = event.payload
  database
    .insert(projectionWorktrees)
    .values({
      ...payload,
      registrationGeneration: 0,
      kind: 'linked',
      ownership: 'unclaimed',
      ...lifecycleFields({ state: 'orphaned', reason: payload.reason, pathKind: payload.pathKind }),
    })
    .run()
}

export function lifecycleFields(lifecycle: WorktreeLifecycle) {
  return {
    lifecycleState: lifecycle.state,
    lifecycleJson: JSON.stringify(v.parse(worktreeLifecycleSchema, lifecycle)),
  }
}

function updateLifecycle(
  database: PlatformDatabase,
  payload: { worktreeId: string; updatedAt: string; operationId?: string },
  lifecycle: WorktreeLifecycle,
) {
  update(database, payload.worktreeId, {
    ...lifecycleFields(lifecycle),
    ...(payload.operationId ? { operationId: payload.operationId } : {}),
    updatedAt: payload.updatedAt,
  })
}

function update(
  database: PlatformDatabase,
  worktreeId: string,
  fields: Partial<typeof projectionWorktrees.$inferInsert>,
) {
  database
    .update(projectionWorktrees)
    .set(fields)
    .where(eq(projectionWorktrees.worktreeId, worktreeId))
    .run()
}

function refreshTerminalCounts(database: PlatformDatabase, worktreeId: string) {
  const leases = database
    .select()
    .from(projectionTerminalLeases)
    .where(eq(projectionTerminalLeases.worktreeId, worktreeId))
    .all()
  update(database, worktreeId, {
    activeTerminalCount: leases.filter(
      (lease) => lease.state !== 'ended' && lease.state !== 'ownership-unknown',
    ).length,
    terminalOwnershipUnknown: leases.some((lease) => lease.state === 'ownership-unknown'),
  })
}

export function refreshAllWorktreePolicies(database: PlatformDatabase) {
  for (const row of database
    .select({ worktreeId: projectionWorktrees.worktreeId })
    .from(projectionWorktrees)
    .all())
    refreshWorktreePolicy(database, row.worktreeId)
}

export function refreshWorktreePolicy(database: PlatformDatabase, worktreeId: string) {
  const row = database
    .select()
    .from(projectionWorktrees)
    .where(eq(projectionWorktrees.worktreeId, worktreeId))
    .get()
  if (!row) return
  const project = database
    .select()
    .from(projectionProjects)
    .where(eq(projectionProjects.projectId, row.projectId))
    .get()
  if (!project) return
  const lifecycle = v.parse(worktreeLifecycleSchema, JSON.parse(row.lifecycleJson))
  const references = database
    .select()
    .from(projectionSessions)
    .where(eq(projectionSessions.worktreeId, worktreeId))
    .all()
    .map((session) => ({ deletedAt: session.deletedAt, deletion: deletionPolicy(session) }))
  const worktree = { ...row, lifecycle }
  update(database, worktreeId, {
    creationCapabilityJson: JSON.stringify(
      worktreeCreationCapability(worktree, project.repositoryKind),
    ),
    cleanupEligibilityJson: JSON.stringify(worktreeCleanupEligibility(worktree, references)),
  })
}

function deletionPolicy(
  session: typeof projectionSessions.$inferSelect,
): SessionDeletionState | null {
  if (session.deletionSequence === null) return null
  return {
    deletionSequence: session.deletionSequence,
    providerStop: session.providerStopState ?? 'requested',
    providerStopError: session.providerStopError,
    blobCleanup: session.blobCleanupState ?? 'requested',
    blobCleanupError: session.blobCleanupError,
    updatedAt: session.deletionUpdatedAt ?? session.updatedAt,
  }
}

export function preserveDiscoveredOwnership(database: PlatformDatabase, event: OrchestrationEvent) {
  if (event.type !== 'session.created' || event.payload.origin !== 'discovered') return
  update(database, event.payload.worktreeId, { externalDriverUnverified: true })
}

const SESSION_WORKTREE_POLICY_EVENTS = new Set<OrchestrationEvent['type']>([
  'session.created',
  'session.deleted',
  'session.deletion-updated',
  'session.runtime-set',
  'session.runtime-recovered',
  'session.runtime-stop-requested',
  'session.provider-start-claimed',
  'session.provider-start-adopted',
  'session.provider-start-settled',
])

export function worktreesAffectedByEvent(
  database: PlatformDatabase,
  event: OrchestrationEvent,
): string[] {
  if (event.aggregateKind === 'worktree') return [event.aggregateId]
  if (event.aggregateKind === 'session') {
    if (!SESSION_WORKTREE_POLICY_EVENTS.has(event.type)) return []
    const row = database
      .select({ worktreeId: projectionSessions.worktreeId })
      .from(projectionSessions)
      .where(eq(projectionSessions.sessionId, event.aggregateId))
      .get()
    return row ? [row.worktreeId] : []
  }
  return database
    .select({ worktreeId: projectionWorktrees.worktreeId })
    .from(projectionWorktrees)
    .where(eq(projectionWorktrees.projectId, event.aggregateId))
    .all()
    .map((row) => row.worktreeId)
}

export function referencingSessionIds(database: PlatformDatabase, worktreeId: string) {
  return database
    .select({ sessionId: projectionSessions.sessionId })
    .from(projectionSessions)
    .where(eq(projectionSessions.worktreeId, worktreeId))
    .all()
    .map((row) => row.sessionId)
}
