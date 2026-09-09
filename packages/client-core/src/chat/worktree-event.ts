import type {
  OrchestrationEvent,
  OrchestrationWorktreeShell,
  RepositoryKind,
  WorktreeLifecycle,
} from '@workspace/contracts'

type WorktreeEvent = Extract<OrchestrationEvent, { type: `worktree.${string}` }>
type Registration = Extract<WorktreeEvent, { type: 'worktree.registered' }>['payload']

export function projectWorktreeEvent(
  held: OrchestrationWorktreeShell | undefined,
  event: WorktreeEvent,
  repositoryKind: RepositoryKind,
): OrchestrationWorktreeShell | undefined {
  if (event.type === 'worktree.registered' || event.type === 'worktree.revived')
    return registeredWorktree(event.payload, repositoryKind)
  if (event.type === 'worktree.create-requested') {
    const payload = event.payload
    const base =
      held ??
      registeredWorktree(
        { ...payload, kind: 'linked', ownership: 'platform', registrationGeneration: 0 },
        repositoryKind,
      )
    return {
      ...base,
      operationId: payload.operationId,
      baseCommit: payload.baseCommit,
      baseWorktreeId: payload.baseWorktreeId,
      pathKind: 'id-derived',
      lifecycle: {
        state: 'provisioning',
        operationId: payload.operationId,
        baseCommit: payload.baseCommit,
        branch: payload.branch,
      },
      worktreeCreationCapability: { allowed: false, reason: 'base-not-ready' },
      updatedAt: payload.updatedAt,
    }
  }
  if (event.type === 'worktree.orphan-registered') {
    const payload = event.payload
    const base = registeredWorktree(
      { ...payload, kind: 'linked', ownership: 'unclaimed', registrationGeneration: 0 },
      repositoryKind,
    )
    return {
      ...base,
      headCommit: payload.headCommit,
      pathKind: payload.pathKind,
      lifecycle: { state: 'orphaned', reason: payload.reason, pathKind: payload.pathKind },
      worktreeCreationCapability: { allowed: false, reason: 'base-not-ready' },
    }
  }
  if (!held) return undefined
  if (event.type === 'worktree.meta-updated')
    return {
      ...held,
      branch: event.payload.branch,
      updatedAt: event.payload.updatedAt,
    }
  if (event.type === 'worktree.metadata-refreshed')
    return {
      ...held,
      branch: event.payload.branch,
      headCommit: event.payload.headCommit,
      metadataVersion: event.payload.metadataVersion,
      updatedAt: event.payload.updatedAt,
    }
  const lifecycle = nextLifecycle(held.lifecycle, event)
  let ownership = held.ownership
  if (event.type === 'worktree.released') ownership = 'external'
  if (event.type === 'worktree.adopted') ownership = 'platform'
  return {
    ...held,
    ownership,
    lifecycle,
    operationId: 'operationId' in lifecycle ? lifecycle.operationId : null,
    headCommit: event.type === 'worktree.created' ? event.payload.headCommit : held.headCommit,
    removedAt: event.type === 'worktree.removed' ? event.payload.removedAt : held.removedAt,
    worktreeCreationCapability: creationCapability(lifecycle, repositoryKind),
    updatedAt: event.occurredAt,
  }
}

function registeredWorktree(
  payload: Registration,
  repositoryKind: RepositoryKind,
): OrchestrationWorktreeShell {
  return {
    ...payload,
    id: payload.worktreeId,
    operationId: null,
    lifecycle: { state: 'ready' },
    baseWorktreeId: null,
    baseCommit: null,
    headCommit: null,
    metadataVersion: 0,
    pathKind: 'legacy',
    activeTerminalCount: 0,
    terminalOwnershipUnknown: false,
    externalDriverUnverified: false,
    removedAt: null,
    worktreeCreationCapability: creationCapability({ state: 'ready' }, repositoryKind),
    cleanupEligibility: {
      reason: 'not-ready',
      nonDeletedSessionCount: 0,
      canResolveMissing: false,
    },
  }
}

function creationCapability(
  lifecycle: WorktreeLifecycle,
  kind: RepositoryKind,
): OrchestrationWorktreeShell['worktreeCreationCapability'] {
  if (lifecycle.state !== 'ready') return { allowed: false, reason: 'base-not-ready' }
  if (kind !== 'git') return { allowed: false, reason: 'not-git' }
  return { allowed: true }
}

function nextLifecycle(held: WorktreeLifecycle, event: WorktreeEvent): WorktreeLifecycle {
  switch (event.type) {
    case 'worktree.created':
    case 'worktree.retained':
    case 'worktree.adopted':
      return { state: 'ready' }
    case 'worktree.creation-failed':
      return {
        state: 'creation-failed',
        operationId: event.payload.operationId,
        errorCode: event.payload.errorCode,
      }
    case 'worktree.cleanup-requested':
      return { ...event.payload, state: 'cleanup-requested' }
    case 'worktree.cleanup-blocked':
      return { ...event.payload, state: 'cleanup-blocked' }
    case 'worktree.cleanup-failed':
      return {
        state: 'cleanup-failed',
        operationId: event.payload.operationId,
        errorCode: event.payload.errorCode,
      }
    case 'worktree.removed':
      return {
        state: 'removed',
        operationId: event.payload.operationId,
        removedAt: event.payload.removedAt,
      }
    case 'worktree.missing':
      return { state: 'missing' }
    case 'worktree.retired':
      return { state: 'retired', retiredAt: event.payload.retiredAt }
    default:
      return held
  }
}
