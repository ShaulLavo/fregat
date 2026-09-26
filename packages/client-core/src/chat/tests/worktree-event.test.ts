import { expect, test } from 'vitest'
import * as v from 'valibot'
import { orchestrationEventSchema, type OrchestrationEventType } from '@workspace/contracts'
import { projectWorktreeEvent } from '../worktree-event'

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
