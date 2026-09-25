import type {
  OrchestrationCommand,
  SessionWorktreeTarget,
  WorktreeProvisioning,
  WorktreeLifecycle,
} from '@workspace/contracts'
import { event, one } from './event-factory'
import {
  requireProject,
  requireSession,
  requireWorktree,
  type OrchestrationReadModel,
} from './read-model'
import { worktreeLifecycleErrors } from './worktree-errors'
import { worktreeFacts } from './utils/decider-facts'
import { worktreeCleanupEligibility } from './utils/worktree-policy'

type Command = Extract<
  OrchestrationCommand,
  { type: `worktree.${string}` | `terminal.lease.${string}` | 'session.worktree.release' }
>
type LifecycleCommand = Exclude<Command, { type: 'worktree.register' | 'worktree.revive' }>

export function requireReadyWorktree(model: OrchestrationReadModel, worktreeId: string) {
  const worktree = requireWorktree(model, worktreeId)
  if (worktree.lifecycle.state !== 'ready')
    throw worktreeLifecycleErrors.NOT_READY({
      worktreeId,
      internal: worktreeFacts({ type: 'worktree.require-ready' }, worktree),
    })
  return worktree
}

export function creationTargetEvents(
  command: OrchestrationCommand,
  target: SessionWorktreeTarget,
  provisioning: WorktreeProvisioning | undefined,
  model: OrchestrationReadModel,
  at: string,
) {
  if (target.kind === 'current') {
    requireReadyWorktree(model, target.worktreeId)
    return []
  }
  const base = requireReadyWorktree(model, target.baseWorktreeId)
  const project = requireProject(model, base.projectId)
  if (project.repositoryKind !== 'git')
    throw worktreeLifecycleErrors.UNSUPPORTED_REPOSITORY({
      worktreeId: base.id,
      internal: { projectId: base.projectId, repositoryKind: project.repositoryKind },
    })
  if (model.worktrees.has(target.worktreeId))
    throw worktreeLifecycleErrors.DUPLICATE_ID({
      worktreeId: target.worktreeId,
      internal: {
        collision: 'id',
        ...worktreeFacts(command, model.worktrees.get(target.worktreeId)),
      },
    })
  if (
    !provisioning ||
    provisioning.worktreeId !== target.worktreeId ||
    provisioning.baseWorktreeId !== target.baseWorktreeId ||
    provisioning.projectId !== base.projectId
  )
    throw worktreeLifecycleErrors.INVALID_PREPARATION({
      worktreeId: target.worktreeId,
      internal: {
        mismatch: 'target',
        observed: provisioning
          ? {
              worktreeId: provisioning.worktreeId,
              baseWorktreeId: provisioning.baseWorktreeId,
              projectId: provisioning.projectId,
            }
          : 'absent',
        expected: {
          worktreeId: target.worktreeId,
          baseWorktreeId: target.baseWorktreeId,
          projectId: base.projectId,
        },
      },
    })
  if (provisioning.branch !== `worktree/${target.worktreeId}`)
    throw worktreeLifecycleErrors.INVALID_PREPARATION({
      worktreeId: target.worktreeId,
      internal: {
        mismatch: 'branch',
        observed: provisioning.branch,
        expected: `worktree/${target.worktreeId}`,
      },
    })
  for (const existing of model.worktrees.values()) {
    if (existing.retiredAt || existing.canonicalPath !== provisioning.canonicalPath) continue
    throw worktreeLifecycleErrors.DUPLICATE_ID({
      worktreeId: target.worktreeId,
      internal: { collision: 'canonicalPath', ...worktreeFacts(command, existing) },
    })
  }
  return one(command, at, 'worktree.create-requested', {
    ...provisioning,
    operationId: command.commandId,
    createdAt: at,
    updatedAt: at,
  })
}

export function decideWorktreeLifecycle(
  command: LifecycleCommand,
  model: OrchestrationReadModel,
  at: string,
) {
  switch (command.type) {
    case 'terminal.lease.request':
    case 'terminal.lease.claim':
    case 'terminal.lease.activate':
    case 'terminal.lease.terminate':
    case 'terminal.lease.end':
    case 'terminal.lease.mark-unknown':
      return terminalLeaseChanged(command, model, at)
    case 'session.worktree.release':
      return releaseTurn(command, model, at)
    case 'worktree.orphan.register':
      return registerOrphan(command, model, at)
    case 'worktree.retry':
      return retryCreation(command, model, at)
    case 'worktree.create.complete':
    case 'worktree.create.fail':
      return creationResult(command, model, at)
    case 'worktree.cleanup':
    case 'worktree.force-cleanup':
      return requestCleanup(command, model, at)
    case 'worktree.cleanup.complete':
    case 'worktree.cleanup.blocked':
    case 'worktree.cleanup.fail':
      return cleanupResult(command, model, at)
    case 'worktree.retain':
    case 'worktree.adopt':
    case 'worktree.release':
    case 'worktree.resolve-missing':
      return ownershipCommand(command, model, at)
    case 'worktree.mark-missing': {
      const worktree = requireWorktree(model, command.worktreeId)
      if (worktree.lifecycle.state !== 'ready')
        throw worktreeLifecycleErrors.STALE_RESULT({
          worktreeId: command.worktreeId,
          internal: { expected: 'ready', ...worktreeFacts(command, worktree) },
        })
      return withBlockedReferences(
        command,
        model,
        at,
        one(command, at, 'worktree.missing', { worktreeId: command.worktreeId, updatedAt: at }),
      )
    }
    case 'worktree.metadata.refresh': {
      const worktree = requireWorktree(model, command.worktreeId)
      if (worktree.metadataVersion !== command.expectedMetadataVersion)
        throw worktreeLifecycleErrors.STALE_RESULT({
          worktreeId: command.worktreeId,
          internal: {
            expectedMetadataVersion: command.expectedMetadataVersion,
            ...worktreeFacts(command, worktree),
          },
        })
      if (worktree.branch === command.branch && worktree.headCommit === command.headCommit)
        return []
      return one(command, at, 'worktree.metadata-refreshed', {
        worktreeId: command.worktreeId,
        branch: command.branch,
        headCommit: command.headCommit,
        metadataVersion: command.expectedMetadataVersion + 1,
        updatedAt: at,
      })
    }
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}

function retryCreation(
  command: Extract<LifecycleCommand, { type: 'worktree.retry' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktree = requireWorktree(model, command.worktreeId)
  if (worktree.ownership !== 'platform' || worktree.lifecycle.state !== 'creation-failed')
    throw worktreeLifecycleErrors.NOT_RETRYABLE({
      worktreeId: command.worktreeId,
      internal: {
        expected: { ownership: 'platform', lifecycleState: 'creation-failed' },
        ...worktreeFacts(command, worktree),
      },
    })
  if (!worktree.baseWorktreeId || !worktree.baseCommit || !worktree.branch)
    throw worktreeLifecycleErrors.INVALID_PREPARATION({
      worktreeId: command.worktreeId,
      internal: {
        missing: ['baseWorktreeId', 'baseCommit', 'branch'].filter(
          (field) => !worktree[field as 'baseWorktreeId' | 'baseCommit' | 'branch'],
        ),
        ...worktreeFacts(command, worktree),
      },
    })
  return one(command, at, 'worktree.create-requested', {
    worktreeId: worktree.id,
    projectId: worktree.projectId,
    baseWorktreeId: worktree.baseWorktreeId,
    baseBranch: worktree.baseBranch ?? null,
    baseCommit: worktree.baseCommit,
    branch: worktree.branch,
    path: worktree.path,
    canonicalPath: worktree.canonicalPath,
    operationId: command.commandId,
    createdAt: worktree.createdAt,
    updatedAt: at,
  })
}

function creationResult(
  command: Extract<LifecycleCommand, { type: 'worktree.create.complete' | 'worktree.create.fail' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktree = requireWorktree(model, command.worktreeId)
  requireOperation(worktree.lifecycle, command, 'provisioning')
  if (command.type === 'worktree.create.complete')
    return one(command, at, 'worktree.created', {
      worktreeId: command.worktreeId,
      operationId: command.operationId,
      headCommit: command.headCommit,
      updatedAt: at,
    })
  return withBlockedReferences(
    command,
    model,
    at,
    one(command, at, 'worktree.creation-failed', {
      worktreeId: command.worktreeId,
      operationId: command.operationId,
      errorCode: command.errorCode,
      updatedAt: at,
    }),
  )
}

function requestCleanup(
  command: Extract<LifecycleCommand, { type: 'worktree.cleanup' | 'worktree.force-cleanup' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktree = requireWorktree(model, command.worktreeId)
  const eligibility = worktreeCleanupEligibility(worktree, references(model, worktree.id))
  if (eligibility.reason !== 'eligible')
    throw worktreeLifecycleErrors.CLEANUP_INELIGIBLE({
      worktreeId: command.worktreeId,
      reason: eligibility.reason,
      internal: { eligibility, ...worktreeFacts(command, worktree) },
    })
  const common = { worktreeId: command.worktreeId, operationId: command.commandId, updatedAt: at }
  if (command.type === 'worktree.force-cleanup')
    return one(command, at, 'worktree.cleanup-requested', {
      ...common,
      mode: 'discard-changes',
      ...command.authorization,
    })
  return one(command, at, 'worktree.cleanup-requested', { ...common, mode: 'safe' })
}

function cleanupResult(
  command: Extract<
    LifecycleCommand,
    { type: 'worktree.cleanup.complete' | 'worktree.cleanup.blocked' | 'worktree.cleanup.fail' }
  >,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktree = model.worktrees.get(command.worktreeId)
  if (!worktree)
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: { missing: 'worktree', ...worktreeFacts(command) },
    })
  requireOperation(worktree.lifecycle, command, 'cleanup-requested')
  if (worktree.lifecycle.state !== 'cleanup-requested' || worktree.lifecycle.mode !== command.mode)
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: {
        expected: { lifecycleState: 'cleanup-requested', mode: command.mode },
        ...worktreeFacts(command, worktree),
      },
    })
  const common = { worktreeId: command.worktreeId, operationId: command.operationId, updatedAt: at }
  if (command.type === 'worktree.cleanup.complete')
    return one(command, at, 'worktree.removed', { ...common, removedAt: at })
  if (command.type === 'worktree.cleanup.fail')
    return one(command, at, 'worktree.cleanup-failed', {
      ...common,
      mode: command.mode,
      errorCode: command.errorCode,
    })
  return one(command, at, 'worktree.cleanup-blocked', {
    ...common,
    mode: command.mode,
    reason: command.reason,
    changedFileCount: command.changedFileCount,
  })
}

function ownershipCommand(
  command: Extract<
    LifecycleCommand,
    { type: 'worktree.retain' | 'worktree.adopt' | 'worktree.release' | 'worktree.resolve-missing' }
  >,
  model: OrchestrationReadModel,
  at: string,
) {
  const worktree = requireWorktree(model, command.worktreeId)
  const common = { worktreeId: worktree.id, updatedAt: at }
  if (command.type === 'worktree.release') {
    if (worktree.ownership !== 'platform' && worktree.ownership !== 'unclaimed')
      throw worktreeLifecycleErrors.CLEANUP_INELIGIBLE({
        worktreeId: command.worktreeId,
        reason: worktree.ownership,
        internal: worktreeFacts(command, worktree),
      })
    if (references(model, worktree.id).some((session) => !session.deletedAt))
      throw worktreeLifecycleErrors.CLEANUP_INELIGIBLE({
        worktreeId: command.worktreeId,
        reason: 'referenced',
        internal: {
          referenceCount: references(model, worktree.id).filter((one) => !one.deletedAt).length,
          ...worktreeFacts(command, worktree),
        },
      })
    if (
      worktree.lifecycle.state === 'provisioning' ||
      worktree.lifecycle.state === 'cleanup-requested'
    )
      throw worktreeLifecycleErrors.NOT_RETRYABLE({
        worktreeId: command.worktreeId,
        internal: { refused: 'release-while-in-flight', ...worktreeFacts(command, worktree) },
      })
    return one(command, at, 'worktree.released', common)
  }
  if (!command.verified)
    throw worktreeLifecycleErrors.INVALID_PREPARATION({
      worktreeId: command.worktreeId,
      internal: { missing: 'verified-observation', ...worktreeFacts(command, worktree) },
    })
  if (command.type === 'worktree.adopt') {
    if (worktree.ownership !== 'unclaimed' || worktree.lifecycle.state !== 'orphaned')
      throw worktreeLifecycleErrors.NOT_RETRYABLE({
        worktreeId: command.worktreeId,
        internal: {
          expected: { ownership: 'unclaimed', lifecycleState: 'orphaned' },
          ...worktreeFacts(command, worktree),
        },
      })
    return one(command, at, 'worktree.adopted', {
      ...common,
      branch: command.branch,
      headCommit: command.headCommit,
    })
  }
  if (command.type === 'worktree.retain') {
    if (
      worktree.ownership !== 'platform' ||
      !['cleanup-blocked', 'cleanup-failed'].includes(worktree.lifecycle.state)
    )
      throw worktreeLifecycleErrors.NOT_RETRYABLE({
        worktreeId: command.worktreeId,
        internal: {
          expected: {
            ownership: 'platform',
            lifecycleState: ['cleanup-blocked', 'cleanup-failed'],
          },
          ...worktreeFacts(command, worktree),
        },
      })
    return one(command, at, 'worktree.retained', common)
  }
  const eligibility = worktreeCleanupEligibility(worktree, references(model, worktree.id))
  if (!eligibility.canResolveMissing)
    throw worktreeLifecycleErrors.CLEANUP_INELIGIBLE({
      worktreeId: command.worktreeId,
      reason: eligibility.reason,
      internal: { eligibility, ...worktreeFacts(command, worktree) },
    })
  if (
    command.authorization.canonicalPath !== worktree.canonicalPath ||
    command.authorization.registrationGeneration !== worktree.registrationGeneration
  )
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: {
        authorizedGeneration: command.authorization.registrationGeneration,
        ...worktreeFacts(command, worktree),
      },
    })
  return one(command, at, 'worktree.removed', {
    ...common,
    operationId: command.commandId,
    removedAt: at,
  })
}

function registerOrphan(
  command: Extract<LifecycleCommand, { type: 'worktree.orphan.register' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  requireProject(model, command.projectId)
  if (model.worktrees.has(command.worktreeId))
    throw worktreeLifecycleErrors.DUPLICATE_ID({
      worktreeId: command.worktreeId,
      internal: {
        collision: 'id',
        ...worktreeFacts(command, model.worktrees.get(command.worktreeId)),
      },
    })
  for (const worktree of model.worktrees.values()) {
    if (worktree.retiredAt || worktree.canonicalPath !== command.canonicalPath) continue
    throw worktreeLifecycleErrors.DUPLICATE_ID({
      worktreeId: command.worktreeId,
      internal: { collision: 'canonicalPath', ...worktreeFacts(command, worktree) },
    })
  }
  return one(command, at, 'worktree.orphan-registered', {
    worktreeId: command.worktreeId,
    projectId: command.projectId,
    canonicalPath: command.canonicalPath,
    path: command.path,
    branch: command.branch,
    headCommit: command.headCommit,
    pathKind: command.pathKind,
    reason: command.reason,
    createdAt: at,
    updatedAt: at,
  })
}

function releaseTurn(
  command: Extract<LifecycleCommand, { type: 'session.worktree.release' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSession(model, command.sessionId)
  const worktree = requireReadyWorktree(model, session.worktreeId)
  const turn = session.latestTurn
  if (
    !turn ||
    turn.turnId !== command.turnId ||
    turn.providerStartState !== 'blocked-on-worktree' ||
    worktree.operationId !== command.operationId
  )
    throw worktreeLifecycleErrors.STALE_RESULT({ worktreeId: worktree.id })
  return one(command, at, 'session.worktree-released', {
    sessionId: session.id,
    worktreeId: worktree.id,
    turnId: turn.turnId,
    operationId: command.operationId,
    updatedAt: at,
  })
}

function withBlockedReferences(
  command: Extract<LifecycleCommand, { worktreeId: string }>,
  model: OrchestrationReadModel,
  at: string,
  events: ReturnType<typeof one>,
) {
  for (const session of references(model, command.worktreeId)) {
    if (session.deletedAt) continue
    events.push(
      event(command, at, 'session.worktree-blocked', {
        sessionId: session.id,
        worktreeId: session.worktreeId,
        turnId: session.latestTurn?.turnId,
        updatedAt: at,
      }),
    )
  }
  return events
}

function references(model: OrchestrationReadModel, worktreeId: string) {
  return [...model.sessions.values()].filter((session) => session.worktreeId === worktreeId)
}

function requireOperation(
  lifecycle: WorktreeLifecycle,
  command: { worktreeId: string; operationId: string },
  state: 'provisioning' | 'cleanup-requested',
) {
  if (lifecycle.state !== state || lifecycle.operationId !== command.operationId)
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: {
        expected: { lifecycleState: state, operationId: command.operationId },
        observed: { lifecycleState: lifecycle.state, operationId: operationIdOf(lifecycle) },
      },
    })
}

function terminalLeaseChanged(
  command: Extract<LifecycleCommand, { type: `terminal.lease.${string}` }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const previous = model.terminalLeases.get(command.terminalLeaseId)
  const common = {
    terminalLeaseId: command.terminalLeaseId,
    worktreeId: command.worktreeId,
    runtimeEpoch: command.runtimeEpoch,
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  }
  if (command.type === 'terminal.lease.request') {
    requireReadyWorktree(model, command.worktreeId)
    if (previous)
      throw worktreeLifecycleErrors.STALE_RESULT({
        worktreeId: command.worktreeId,
        internal: { refused: 'lease-exists', leaseState: previous.state, ...leaseFacts(command) },
      })
    return one(command, at, 'terminal.lease-updated', { ...common, state: 'requested' })
  }
  if (
    !previous ||
    previous.worktreeId !== command.worktreeId ||
    previous.runtimeEpoch !== command.runtimeEpoch
  )
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: {
        observed: previous
          ? { worktreeId: previous.worktreeId, runtimeEpoch: previous.runtimeEpoch }
          : 'absent',
        ...leaseFacts(command),
      },
    })
  const state = terminalLeaseTransition(command.type, previous.state)
  if (!state)
    throw worktreeLifecycleErrors.STALE_RESULT({
      worktreeId: command.worktreeId,
      internal: { refused: 'transition', leaseState: previous.state, ...leaseFacts(command) },
    })
  return one(command, at, 'terminal.lease-updated', { ...common, state })
}

function terminalLeaseTransition(
  type: Exclude<
    Extract<LifecycleCommand, { type: `terminal.lease.${string}` }>['type'],
    'terminal.lease.request'
  >,
  state: import('@workspace/contracts').TerminalLease['state'],
): import('@workspace/contracts').TerminalLease['state'] | null {
  if (type === 'terminal.lease.claim' && state === 'requested') return 'claimed'
  if (type === 'terminal.lease.activate' && state === 'claimed') return 'active'
  if (type === 'terminal.lease.terminate' && ['claimed', 'active'].includes(state))
    return 'termination-requested'
  if (type === 'terminal.lease.end' && state !== 'ownership-unknown' && state !== 'ended')
    return 'ended'
  if (
    type === 'terminal.lease.mark-unknown' &&
    ['claimed', 'active', 'termination-requested'].includes(state)
  )
    return 'ownership-unknown'
  return null
}

function operationIdOf(lifecycle: WorktreeLifecycle) {
  return 'operationId' in lifecycle ? lifecycle.operationId : undefined
}

function leaseFacts(command: { type: string; terminalLeaseId: string; runtimeEpoch: string }) {
  return {
    commandType: command.type,
    terminalLeaseId: command.terminalLeaseId,
    runtimeEpoch: command.runtimeEpoch,
  }
}
