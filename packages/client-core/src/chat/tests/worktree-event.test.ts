import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import {
  commandIdSchema,
  eventIdSchema,
  orchestrationEventSchema,
  projectIdSchema,
  worktreeIdSchema,
  type OrchestrationEvent,
  type OrchestrationEventType,
} from '@workspace/contracts'
import { projectWorktreeEvent } from '../worktree-event'

const WORKTREE_ID = v.parse(worktreeIdSchema, '11111111-1111-4111-8111-111111111111')
const PROJECT_ID = v.parse(projectIdSchema, '22222222-2222-4222-8222-222222222222')
const EVENT_ID = v.parse(eventIdSchema, 'evt-worktree-registered')
const COMMAND_ID = v.parse(commandIdSchema, 'cmd-worktree-registered')

function worktreeRegisteredEvent(
  retiredAt: string | null,
): Extract<OrchestrationEvent, { type: 'worktree.registered' }> {
  return {
    sequence: 1,
    eventId: EVENT_ID,
    aggregateKind: 'worktree',
    aggregateId: WORKTREE_ID,
    occurredAt: '2026-01-01T00:00:00.000Z',
    commandId: COMMAND_ID,
    causationEventId: null,
    correlationId: null,
    actorKind: 'server',
    metadata: {},
    type: 'worktree.registered',
    payload: {
      worktreeId: WORKTREE_ID,
      projectId: PROJECT_ID,
      registrationGeneration: 0,
      canonicalPath: '/repo',
      path: '/repo',
      branch: null,
      kind: 'current',
      ownership: 'protected',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      retiredAt,
    },
  }
}

describe('projectWorktreeEvent', () => {
  // A worktree.registered/revived payload can carry a non-null retiredAt when a
  // revival races a later retirement; the client must read that the same way the
  // server does instead of hardcoding `ready`.
  test('a retired worktree arriving via worktree.registered is not allowed to create', () => {
    const event = worktreeRegisteredEvent('2026-01-02T00:00:00.000Z')

    const shell = projectWorktreeEvent(undefined, event, 'git')

    expect(shell?.lifecycle).toEqual({ state: 'retired', retiredAt: '2026-01-02T00:00:00.000Z' })
    expect(shell?.worktreeCreationCapability).toEqual({
      allowed: false,
      reason: 'base-not-ready',
    })
  })

  test('a fresh registration reads ready and allowed for a git repository', () => {
    const event = worktreeRegisteredEvent(null)

    const shell = projectWorktreeEvent(undefined, event, 'git')

    expect(shell?.lifecycle).toEqual({ state: 'ready' })
    expect(shell?.worktreeCreationCapability).toEqual({ allowed: true })
  })
})

const worktreeId = 'c19636f4-df40-44a3-b8d2-e5201d9766a2'
const at = '2026-09-25T00:00:00.000Z'
const registration = {
  worktreeId,
  projectId: '12c7943d-799e-4c27-b6f3-4f5c57f01875',
  registrationGeneration: 0,
  canonicalPath: '/checkout',
  path: '/checkout',
  branch: `worktree/${worktreeId}`,
  kind: 'linked',
  ownership: 'external',
  createdAt: at,
  updatedAt: at,
}

function event(type: OrchestrationEventType, payload: object) {
  const parsed = v.parse(orchestrationEventSchema, {
    type,
    payload,
    sequence: 1,
    eventId: 'event-parent',
    occurredAt: at,
    commandId: 'parent-command',
    causationEventId: null,
    correlationId: null,
    aggregateKind: 'worktree',
    aggregateId: worktreeId,
    actorKind: 'server',
    metadata: {},
  })
  if (
    parsed.type !== 'worktree.create-requested' &&
    parsed.type !== 'worktree.released' &&
    parsed.type !== 'worktree.revived'
  )
    throw new TypeError('Unexpected fixture event')
  return parsed
}

test.each(['worktree.released', 'worktree.revived'] as const)(
  '%s clears the client creation parent',
  (type) => {
    const created = projectWorktreeEvent(
      undefined,
      event('worktree.create-requested', {
        ...registration,
        operationId: '8cd29f12-b782-4946-9ee1-9c911ec71b59',
        baseWorktreeId: '4d10b6f6-9bfd-409c-b048-baa1fa249a52',
        baseBranch: 'main',
        baseCommit: 'a'.repeat(40),
      }),
      'git',
    )
    expect(created).toMatchObject({ baseBranch: 'main', ownership: 'platform' })

    const next = projectWorktreeEvent(created, event(type, registration), 'git')

    expect(next).toMatchObject({ baseBranch: null, ownership: 'external' })
  },
)
