import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { projectIdSchema, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  activeSession,
  activeSessionShowsComposer,
} from '@/features/chat-mode/utils/active-session'
import type { ChatSelection } from '@/lib/chat-selection'
import { expect, test } from '../../../../../test/fixtures'

const projectId = v.parse(projectIdSchema, '609d2bd3-7993-5564-9918-c603beaa32c6')
const otherProjectId = v.parse(projectIdSchema, 'f74c43d6-6c1a-5ffc-bc76-35db1119ab17')
const sessionA = v.parse(sessionIdSchema, '0cecbcf1-b3a4-5425-826e-9780b43b7832')
const sessionB = v.parse(sessionIdSchema, 'ea35feb3-d322-5206-93b3-fad28939a07d')

test('falls back to the newest session when nothing is picked', () => {
  const session = resolve({ selection: { kind: 'auto' }, sessionIds: [sessionA, sessionB] })

  expect(session).toEqual({ status: 'auto', sessionId: sessionA })
  expect(activeSessionShowsComposer(session)).toBe(false)
})

test('shows the composer when the project has no sessions', () => {
  const session = resolve({ selection: { kind: 'auto' }, sessionIds: [] })

  expect(session.sessionId).toBeNull()
  expect(activeSessionShowsComposer(session)).toBe(true)
})

test('keeps the composer open for a draft started in the open project', () => {
  const session = resolve({
    selection: { kind: 'draft', environmentId: TEST_ENVIRONMENT_ID, projectId },
    sessionIds: [sessionA],
  })

  expect(session.status).toBe('draft')
  expect(activeSessionShowsComposer(session)).toBe(true)
})

test('resolves a picked session that belongs to the open project', () => {
  const session = resolve({
    selection: {
      kind: 'session',
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      sessionId: sessionB,
    },
    sessionIds: [sessionA, sessionB],
  })

  expect(session).toEqual({ status: 'ready', sessionId: sessionB })
})

test('waits while a freshly created session has not landed in the projection', () => {
  const session = resolve({
    selection: {
      kind: 'session',
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      sessionId: sessionB,
    },
    sessionIds: [sessionA],
  })

  expect(session.status).toBe('resolving')
})

test('falls back to the active project when the pick names another one', () => {
  const session = resolve({
    selection: {
      kind: 'session',
      environmentId: TEST_ENVIRONMENT_ID,
      projectId: otherProjectId,
      sessionId: sessionB,
    },
    sessionIds: [sessionA],
  })

  expect(session).toEqual({ status: 'auto', sessionId: sessionA })
})

test('abandons a stale foreign draft instead of stranding the stage', () => {
  const session = resolve({
    selection: { kind: 'draft', environmentId: TEST_ENVIRONMENT_ID, projectId: otherProjectId },
    sessionIds: [],
  })

  expect(session).toEqual({ status: 'auto', sessionId: null })
  expect(activeSessionShowsComposer(session)).toBe(true)
})

test('reports a restored pick whose session no longer exists as gone', () => {
  const session = resolve({
    restored: true,
    selection: {
      kind: 'session',
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      sessionId: sessionB,
    },
    sessionIds: [sessionA],
  })

  // Not `resolving`: nothing is on its way, and a spinner here is an app that hangs.
  expect(session).toEqual({ status: 'missing', sessionId: null })
})

test('waits on a restored pick until its project has loaded', () => {
  const session = activeSession({
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: null,
    restored: true,
    selection: {
      kind: 'session',
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      sessionId: sessionB,
    },
    sessionIds: [],
  })

  expect(session.status).toBe('resolving')
})

function resolve({
  restored = false,
  selection,
  sessionIds,
}: {
  restored?: boolean
  selection: ChatSelection
  sessionIds: readonly ReturnType<typeof v.parse<typeof sessionIdSchema>>[]
}) {
  return activeSession({
    environmentId: TEST_ENVIRONMENT_ID,
    projectId,
    restored,
    selection,
    sessionIds,
  })
}
