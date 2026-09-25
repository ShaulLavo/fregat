import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import {
  commandIdSchema,
  eventIdSchema,
  projectIdSchema,
  worktreeIdSchema,
  type OrchestrationEvent,
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
