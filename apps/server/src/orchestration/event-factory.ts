import * as v from 'valibot'
import {
  eventIdSchema,
  orchestrationEventSchema,
  type EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationEventMetadata,
} from '@workspace/contracts'
import type { PendingOrchestrationEvent } from './event-store'

type EventPayloads = {
  [Type in OrchestrationEvent['type']]: Extract<OrchestrationEvent, { type: Type }>['payload']
}

type EnvelopeOptions = {
  readonly causationEventId?: EventId
  readonly metadata?: OrchestrationEventMetadata
}

export function event<Type extends OrchestrationEvent['type']>(
  command: OrchestrationCommand,
  at: string,
  type: Type,
  payload: EventPayloads[Type],
  options?: EnvelopeOptions,
): PendingOrchestrationEvent {
  const parsed = v.parse(orchestrationEventSchema, {
    sequence: 0,
    actorKind: commandActor(command),
    ...aggregate(payload),
    causationEventId: options?.causationEventId ?? null,
    commandId: command.commandId,
    correlationId: command.commandId,
    eventId: v.parse(eventIdSchema, `event-${crypto.randomUUID()}`),
    metadata: options?.metadata ?? {},
    occurredAt: at,
    payload,
    type,
  })
  const { sequence: _sequence, ...pending } = parsed
  return pending
}

export function one<Type extends OrchestrationEvent['type']>(
  command: OrchestrationCommand,
  at: string,
  type: Type,
  payload: EventPayloads[Type],
  options?: EnvelopeOptions,
) {
  return [event<Type>(command, at, type, payload, options)]
}

function aggregate(payload: OrchestrationEvent['payload']) {
  if ('sessionId' in payload) return { aggregateId: payload.sessionId, aggregateKind: 'session' }
  if ('worktreeId' in payload) return { aggregateId: payload.worktreeId, aggregateKind: 'worktree' }
  return { aggregateId: payload.projectId, aggregateKind: 'project' }
}

function commandActor(command: OrchestrationCommand) {
  const type = command.type
  if (
    type.startsWith('session.message.') ||
    type === 'session.runtime.set' ||
    type === 'session.activity.append' ||
    type === 'session.proposed-plan.upsert'
  )
    return 'provider'
  if (
    [
      'worktree.retry',
      'worktree.cleanup',
      'worktree.force-cleanup',
      'worktree.retain',
      'worktree.adopt',
      'worktree.release',
      'worktree.resolve-missing',
    ].includes(type)
  )
    return 'client'
  if (
    type.startsWith('terminal.lease.') ||
    type === 'session.worktree.release' ||
    type.startsWith('worktree.') ||
    type.startsWith('session.provider-start.') ||
    type === 'project.revive' ||
    type === 'session.discover' ||
    type === 'session.discovery-metadata.update' ||
    type === 'session.history.import' ||
    type === 'session.terminal-history.append' ||
    type === 'session.runtime.recover' ||
    type === 'session.deletion.update' ||
    type === 'session.turn.diff.complete' ||
    type === 'session.revert.complete'
  )
    return 'server'
  return 'client'
}
