import { requireReadyWorktree } from './worktree-decider'
import type { OrchestrationCommand } from '@workspace/contracts'
import { event, one } from './event-factory'
import { requireSession, type OrchestrationReadModel } from './read-model'
import { sessionDomainErrors } from './structured-errors'

type ProviderStartCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | 'session.provider-start.claim'
      | 'session.provider-start.adopt'
      | 'session.provider-start.settle'
  }
>

export function decideProviderStart(
  command: ProviderStartCommand,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSession(model, command.sessionId)
  const turn = session.latestTurn
  if (
    !turn ||
    turn.turnId !== command.turnId ||
    turn.providerStartSequence !== command.observedSequence
  ) {
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'turn-identity',
        commandType: command.type,
        observed: { turnId: turn?.turnId, providerStartSequence: turn?.providerStartSequence },
        expected: { turnId: command.turnId, observedSequence: command.observedSequence },
      },
    })
  }
  if (command.type === 'session.provider-start.claim') {
    requireReadyWorktree(model, session.worktreeId)
    return claimStart(command, turn, at)
  }
  if (
    turn.runtimeEpoch !== command.runtimeEpoch ||
    turn.providerStartGeneration !== command.generation
  ) {
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'epoch-generation',
        commandType: command.type,
        observed: {
          runtimeEpoch: turn.runtimeEpoch,
          providerStartGeneration: turn.providerStartGeneration,
        },
        expected: { runtimeEpoch: command.runtimeEpoch, generation: command.generation },
      },
    })
  }
  const expected = command.type === 'session.provider-start.adopt' ? 'claimed' : 'adopted'
  if (turn.providerStartState !== expected)
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'start-state',
        commandType: command.type,
        observed: turn.providerStartState,
        expected,
      },
    })
  const type =
    command.type === 'session.provider-start.adopt'
      ? 'session.provider-start-adopted'
      : 'session.provider-start-settled'
  return one(command, at, type, startPayload(command))
}

function claimStart(
  command: ProviderStartCommand,
  turn: NonNullable<ReturnType<typeof requireSession>['latestTurn']>,
  at: string,
) {
  if (
    turn.providerStartState !== 'queued' ||
    command.generation !== turn.providerStartGeneration + 1
  ) {
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'claim',
        observed: {
          providerStartState: turn.providerStartState,
          providerStartGeneration: turn.providerStartGeneration,
        },
        expected: { providerStartState: 'queued', generation: command.generation },
      },
    })
  }
  return one(command, at, 'session.provider-start-claimed', startPayload(command))
}

function startPayload(command: ProviderStartCommand) {
  return {
    sessionId: command.sessionId,
    turnId: command.turnId,
    generation: command.generation,
    runtimeEpoch: command.runtimeEpoch,
    createdAt: command.createdAt,
  }
}

export function decideRuntimeRecovery(
  command: Extract<OrchestrationCommand, { type: 'session.runtime.recover' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = requireSession(model, command.sessionId)
  const turn = session.latestTurn
  const observedTurn =
    turn &&
    command.turnId === turn.turnId &&
    turn.providerStartSequence === command.observedSequence
  const observedRuntime = session.runtimeSequence === command.observedSequence
  const epoch = command.turnId ? turn?.runtimeEpoch : session.runtime?.runtimeEpoch
  if ((!observedTurn && !observedRuntime) || epoch !== command.runtimeEpoch) {
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'runtime-recovery',
        observedTurn,
        observedRuntime,
        observedEpoch: epoch ?? null,
        expectedEpoch: command.runtimeEpoch,
      },
    })
  }
  return [
    event(command, at, 'session.runtime-recovered', {
      sessionId: command.sessionId,
      turnId: command.turnId,
      observedSequence: command.observedSequence,
      runtimeEpoch: command.runtimeEpoch,
      message: command.message,
      createdAt: command.createdAt,
    }),
  ]
}

export function decideDeletionUpdate(
  command: Extract<OrchestrationCommand, { type: 'session.deletion.update' }>,
  model: OrchestrationReadModel,
  at: string,
) {
  const session = model.sessions.get(command.sessionId)
  if (
    !session?.deletedAt ||
    session.deletion?.deletionSequence !== command.deletion.deletionSequence
  ) {
    throw sessionDomainErrors.START_STATE_CONFLICT({
      sessionId: command.sessionId,
      internal: {
        at: 'deletion-update',
        deleted: Boolean(session?.deletedAt),
        observedSequence: session?.deletion?.deletionSequence ?? null,
        expectedSequence: command.deletion.deletionSequence,
      },
    })
  }
  return one(command, at, 'session.deletion-updated', {
    sessionId: command.sessionId,
    deletion: command.deletion,
  })
}
