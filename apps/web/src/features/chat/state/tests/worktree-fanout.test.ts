import { orchestrationEventSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import {
  applyChatProjectionEvent,
  applyChatProjectionShellStreamItem,
  syncChatProjectionShellSnapshot,
} from '@workspace/client-core/chat/writers'
import {
  chatWorktree,
  fixtureSessionId,
  sessionShell,
  shellSnapshot,
  TEST_SESSION_ID,
  TEST_WORKTREE_ID,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

test('one lifecycle sequence updates its worktree and every referencing session exactly once', () => {
  const secondId = fixtureSessionId(2)
  let state = syncChatProjectionShellSnapshot(
    createInitialChatProjectionSlice(),
    shellSnapshot({ sessions: [sessionShell(), sessionShell({ id: secondId })] }),
  )
  const worktree = chatWorktree({
    lifecycle: { state: 'missing' },
    worktreeCreationCapability: { allowed: false, reason: 'base-not-ready' },
  })
  const sessions = [TEST_SESSION_ID, secondId].map((id) =>
    sessionShell({
      id,
      attentionState: 'needs-input',
      attentionReason: 'worktree',
      hasError: true,
    }),
  )
  state = applyChatProjectionShellStreamItem(state, {
    kind: 'worktree-upserted',
    worktree,
    sequence: 2,
  })
  for (const session of sessions)
    state = applyChatProjectionShellStreamItem(state, {
      kind: 'session-upserted',
      session,
      sequence: 2,
    })
  expect(state.worktreeById[TEST_WORKTREE_ID]?.lifecycle.state).toBe('missing')
  expect(state.sessionById[TEST_SESSION_ID]?.attentionReason).toBe('worktree')
  expect(state.sessionById[secondId]?.attentionReason).toBe('worktree')
  expect(
    applyChatProjectionShellStreamItem(state, {
      kind: 'worktree-upserted',
      worktree: chatWorktree(),
      sequence: 2,
    }),
  ).toBe(state)
  expect(
    applyChatProjectionShellStreamItem(state, {
      kind: 'session-upserted',
      session: sessionShell(),
      sequence: 1,
    }),
  ).toBe(state)
})

test('an authoritative snapshot fences every equal-sequence delta including a previously unseen entity', () => {
  const state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shellSnapshot())
  const update = {
    kind: 'session-upserted' as const,
    session: sessionShell({ id: fixtureSessionId(2) }),
    sequence: 1,
  }
  expect(applyChatProjectionShellStreamItem(state, update)).toBe(state)
})

test('historical branch events replay while newer worktree snapshots fence stale metadata', () => {
  const state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shellSnapshot())
  const event = v.parse(orchestrationEventSchema, {
    type: 'worktree.meta-updated',
    eventId: 'historical-branch-event',
    sequence: 2,
    occurredAt: '2026-05-28T00:00:02.000Z',
    actorKind: 'client',
    aggregateKind: 'worktree',
    aggregateId: TEST_WORKTREE_ID,
    commandId: 'historical-branch-command',
    correlationId: 'historical-branch-command',
    causationEventId: null,
    metadata: {},
    payload: {
      worktreeId: TEST_WORKTREE_ID,
      branch: 'topic',
      updatedAt: '2026-05-28T00:00:02.000Z',
    },
  })
  const updated = applyChatProjectionEvent(state, event)
  expect(updated.worktreeById[TEST_WORKTREE_ID]?.branch).toBe('topic')
  const snapshotted = syncChatProjectionShellSnapshot(updated, {
    ...shellSnapshot({ worktrees: [chatWorktree({ branch: 'main' })] }),
    snapshotSequence: 3,
  })
  expect(applyChatProjectionEvent(snapshotted, event).worktreeById[TEST_WORKTREE_ID]?.branch).toBe(
    'main',
  )
})

test('a turn blocked on its checkout can be interrupted before a provider runtime exists', () => {
  const source = sessionShell()
  const blocked = sessionShell({
    runtime: null,
    latestTurn: { ...source.latestTurn!, providerStartState: 'blocked-on-worktree' },
  })
  const state = syncChatProjectionShellSnapshot(
    createInitialChatProjectionSlice(),
    shellSnapshot({ sessions: [blocked] }),
  )
  expect(isChatSessionBusy(selectChatSessionById(state, TEST_SESSION_ID))).toBe(true)
  const interrupted = applyChatProjectionEvent(
    state,
    v.parse(orchestrationEventSchema, {
      type: 'session.turn-interrupt-requested',
      eventId: 'blocked-turn-interrupt',
      sequence: 2,
      occurredAt: '2026-05-28T00:00:02.000Z',
      actorKind: 'client',
      aggregateKind: 'session',
      aggregateId: TEST_SESSION_ID,
      commandId: 'blocked-turn-interrupt',
      correlationId: 'blocked-turn-interrupt',
      causationEventId: null,
      metadata: {},
      payload: {
        sessionId: TEST_SESSION_ID,
        turnId: source.latestTurn!.turnId,
        createdAt: '2026-05-28T00:00:02.000Z',
      },
    }),
  )
  const session = selectChatSessionById(interrupted, TEST_SESSION_ID)
  expect(session?.latestTurn).toMatchObject({
    state: 'interrupted',
    providerStartState: 'interrupted',
  })
  expect(isChatSessionBusy(session)).toBe(false)
})
