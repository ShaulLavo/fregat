import * as v from 'valibot'
import { orchestrationEventSchema, type OrchestrationEventType } from '@workspace/contracts'

export const DOMAIN_IDS = {
  project: '12c7943d-799e-4c27-b6f3-4f5c57f01875',
  worktree: '4d10b6f6-9bfd-409c-b048-baa1fa249a52',
  session: 'd2b3ea2b-7e36-4549-b0d4-043c00904574',
  turn: 'turn-fixture',
} as const
export const DOMAIN_AT = '2026-09-05T00:00:00.000Z'
export const DOMAIN_MODEL = { providerInstanceId: 'mock', model: 'mock-model' } as const

export function domainEvent(
  type: OrchestrationEventType,
  payload: Record<string, unknown>,
  ordinal: number,
) {
  return v.parse(orchestrationEventSchema, {
    type,
    payload,
    ...eventAggregate(payload),
    sequence: ordinal,
    eventId: `event-domain-${ordinal}`,
    occurredAt: DOMAIN_AT,
    commandId: `command-domain-${ordinal}`,
    causationEventId: null,
    correlationId: null,
    actorKind: 'server',
    metadata: {},
  })
}

export function domainBootstrap() {
  return [
    domainEvent(
      'project.created',
      {
        projectId: DOMAIN_IDS.project,
        title: 'Fixture',
        repositoryKey: 'fixture-repository',
        repositoryKind: 'directory',
        repositoryIdentity: { source: 'path', canonical: '/fixture' },
        defaultModelSelection: DOMAIN_MODEL,
        createdAt: DOMAIN_AT,
        updatedAt: DOMAIN_AT,
      },
      1,
    ),
    domainEvent(
      'worktree.registered',
      {
        worktreeId: DOMAIN_IDS.worktree,
        projectId: DOMAIN_IDS.project,
        registrationGeneration: 0,
        canonicalPath: '/fixture',
        path: '/fixture',
        branch: null,
        kind: 'current',
        ownership: 'protected',
        createdAt: DOMAIN_AT,
        updatedAt: DOMAIN_AT,
        retiredAt: null,
      },
      2,
    ),
    domainEvent(
      'session.created',
      {
        sessionId: DOMAIN_IDS.session,
        worktreeId: DOMAIN_IDS.worktree,
        origin: 'platform',
        title: 'Session',
        modelSelection: DOMAIN_MODEL,
        runtimeMode: 'full-access',
        interactionMode: 'default',
        createdAt: DOMAIN_AT,
        updatedAt: DOMAIN_AT,
      },
      3,
    ),
  ]
}

function eventAggregate(payload: Record<string, unknown>) {
  if ('sessionId' in payload) return { aggregateKind: 'session', aggregateId: payload.sessionId }
  if ('worktreeId' in payload) return { aggregateKind: 'worktree', aggregateId: payload.worktreeId }
  return { aggregateKind: 'project', aggregateId: payload.projectId }
}
