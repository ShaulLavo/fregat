import {
  chatWorktree as fixtureWorktree,
  chatProject as fixtureProject,
  sessionShell as fixtureSessionShell,
} from '../../../../../test/factories/chat'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  commandIdSchema,
  eventIdSchema,
  messageIdSchema,
  projectIdSchema,
  proposedPlanIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationCheckpointSummary,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationProposedPlan,
  type OrchestrationSession,
  type OrchestrationSessionActivity,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionShell,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  CHAT_ACTIVITY_CACHE_LIMIT,
  CHAT_MESSAGE_CACHE_LIMIT,
} from '@workspace/client-core/chat/cache-constants'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import {
  applyChatProjectionEvent,
  applyChatProjectionShellStreamItem,
  syncChatProjectionShellSnapshot,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'
import { expect, test } from '../../../../../test/fixtures'

test('preserves existing detail for sessions still present in a shell snapshot', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const message = makeMessage(1, sessionId)
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 1,
      session: makeSessionDetail({ id: sessionId, messages: [message], title: 'detail title' }),
    }),
  )
  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 2,
    sessions: [makeSessionShell({ id: sessionId, title: 'shell title' })],
    updatedAt: timestamp(2),
  })

  expect(state.messageIdsBySessionId[sessionId]).toEqual([message.id])
  expect(state.messageBySessionId[sessionId]?.[message.id]?.text).toBe(message.text)
  expect(state.sessionById[sessionId]?.title).toBe('shell title')
})

test('removes all session-scoped state when the shell removes a session', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const otherSessionId = parseSessionId('83820f69-dec0-53d9-9ab5-fddbd1dabb2d')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId }), makeSessionShell({ id: otherSessionId })],
    updatedAt: timestamp(1),
  })
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 2,
      session: makeSessionDetail({
        activities: [makeActivity(1, sessionId)],
        id: sessionId,
        messages: [makeMessage(1, sessionId)],
      }),
    }),
  )
  state = applyChatProjectionShellStreamItem(state, {
    kind: 'session-removed',
    sequence: 3,
    sessionId,
  })

  expect(state.sessionIds).toEqual([otherSessionId])
  expect(state.sessionById[sessionId]).toBeUndefined()
  expect(state.messageIdsBySessionId[sessionId]).toBeUndefined()
  expect(state.activityIdsBySessionId[sessionId]).toBeUndefined()
})

test('applies a detail snapshot only to the target session detail slices', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const otherSessionId = parseSessionId('83820f69-dec0-53d9-9ab5-fddbd1dabb2d')
  const otherMessage = makeMessage(2, otherSessionId)
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [
      makeSessionShell({ id: sessionId, title: 'shell session' }),
      makeSessionShell({ id: otherSessionId, title: 'other shell session' }),
    ],
    updatedAt: timestamp(1),
  })
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 2,
      session: makeSessionDetail({ id: otherSessionId, messages: [otherMessage] }),
    }),
  )
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 3,
      session: makeSessionDetail({
        id: sessionId,
        messages: [makeMessage(1, sessionId)],
        title: 'detail session',
      }),
    }),
  )

  expect(state.messageIdsBySessionId[otherSessionId]).toEqual([otherMessage.id])
  expect(state.messageIdsBySessionId[sessionId]).toEqual([parseMessageId('message-1')])
  expect(state.sessionById[sessionId]?.title).toBe('shell session')
})

test('a session detail snapshot cannot revert shell-published metadata', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId, title: 'shell session' })],
    updatedAt: timestamp(1),
  })

  const sessionBefore = state.sessionById[sessionId]
  const sessionIds = state.sessionIds

  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 2,
      session: makeSessionDetail({
        id: sessionId,
        title: 'detail session',
      }),
    }),
  )

  expect(state.sessionById[sessionId]).toMatchObject({
    metaSource: 'shell',
    runtime: sessionBefore?.runtime,
    title: 'shell session',
    worktreeId: sessionBefore?.worktreeId,
  })
  expect(state.sessionById[sessionId]?.detailSynced).toBe(true)
  expect(state.sessionIds).toBe(sessionIds)
})

test('trims message and activity detail arrays deterministically', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const messages = Array.from({ length: CHAT_MESSAGE_CACHE_LIMIT + 5 }, (_, index) =>
    makeMessage(index, sessionId),
  )
  const activities = Array.from({ length: CHAT_ACTIVITY_CACHE_LIMIT + 5 }, (_, index) =>
    makeActivity(index, sessionId),
  )

  const state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    makeDetailSnapshot({
      snapshotSequence: 1,
      session: makeSessionDetail({ activities, id: sessionId, messages }),
    }),
  )

  expect(state.messageIdsBySessionId[sessionId]).toHaveLength(CHAT_MESSAGE_CACHE_LIMIT)
  expect(state.activityIdsBySessionId[sessionId]).toHaveLength(CHAT_ACTIVITY_CACHE_LIMIT)
  expect(state.messageIdsBySessionId[sessionId]?.[0]).toBe(messages[5]?.id)
  expect(state.activityIdsBySessionId[sessionId]?.[0]).toBe(activities[5]?.id)
})

test('ignores stale shell and detail snapshots', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject({ title: 'new project' })],
    snapshotSequence: 5,
    sessions: [makeSessionShell({ id: sessionId, title: 'new session' })],
    updatedAt: timestamp(5),
  })
  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject({ title: 'old project' })],
    snapshotSequence: 4,
    sessions: [makeSessionShell({ id: sessionId, title: 'old session' })],
    updatedAt: timestamp(4),
  })
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 6,
      session: makeSessionDetail({ id: sessionId, messages: [makeMessage(6, sessionId)] }),
    }),
  )
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 5,
      session: makeSessionDetail({ id: sessionId, messages: [makeMessage(5, sessionId)] }),
    }),
  )

  expect(state.projectById[parseProjectId('609d2bd3-7993-5564-9918-c603beaa32c6')]?.title).toBe(
    'new project',
  )
  expect(state.sessionById[sessionId]?.title).toBe('new session')
  expect(state.messageIdsBySessionId[sessionId]).toEqual([parseMessageId('message-6')])
})

test('applies equal-sequence detail snapshots as authoritative detail state', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const message = makeMessage(6, sessionId)
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 6,
      session: makeSessionDetail({ id: sessionId, messages: [] }),
    }),
  )
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({
      snapshotSequence: 6,
      session: makeSessionDetail({ id: sessionId, messages: [message] }),
    }),
  )

  expect(state.messageIdsBySessionId[sessionId]).toEqual([message.id])
  expect(state.messageBySessionId[sessionId]?.[message.id]?.text).toBe(message.text)
})

// The snapshot is the whole truth for plans and checkpoints: a plan resolved (or turns
// reverted) while the stream was down leaves no event behind to remove it, so merging
// would keep the ghost — and an actionable ghost pins the subscription against eviction.
test('a detail snapshot drops plans and turn diffs the server no longer reports', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  const planId = parseProposedPlanId('plan-1')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId })],
    updatedAt: timestamp(1),
  })
  state = applyChatProjectionEvent(state, proposedPlanUpsertedEvent(sessionId, planId, 2))
  state = applyChatProjectionEvent(state, turnDiffCompletedEvent(sessionId, turnId, 3))

  expect(state.proposedPlanIdsBySessionId[sessionId]).toEqual([planId])
  expect(state.turnDiffIdsBySessionId[sessionId]).toEqual([turnId])

  state = syncChatProjectionSessionDetailSnapshot(
    state,
    makeDetailSnapshot({ snapshotSequence: 4, session: makeSessionDetail({ id: sessionId }) }),
  )

  expect(state.proposedPlanIdsBySessionId[sessionId]).toEqual([])
  expect(state.proposedPlanBySessionId[sessionId]).toEqual({})
  expect(state.turnDiffIdsBySessionId[sessionId]).toEqual([])
  expect(state.turnDiffSummaryBySessionId[sessionId]).toEqual({})
})

test('a cold detail snapshot paints the plans and checkpoints it carries', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const olderPlanId = parseProposedPlanId('plan-older')
  const newerPlanId = parseProposedPlanId('plan-newer')
  const turnId = parseTurnId('turn-1')

  const state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    makeDetailSnapshot({
      checkpoints: [makeCheckpoint(turnId)],
      proposedPlans: [
        makeProposedPlan({ createdAt: timestamp(4), id: newerPlanId, sessionId }),
        makeProposedPlan({ createdAt: timestamp(2), id: olderPlanId, sessionId }),
      ],
      snapshotSequence: 1,
      session: makeSessionDetail({ id: sessionId }),
    }),
  )

  expect(state.proposedPlanIdsBySessionId[sessionId]).toEqual([olderPlanId, newerPlanId])
  expect(state.turnDiffIdsBySessionId[sessionId]).toEqual([turnId])
  expect(state.turnDiffSummaryBySessionId[sessionId]?.[turnId]).toMatchObject({
    checkpointRef: 'checkpoint-1',
    files: [{ additions: 3, deletions: 1, kind: 'modified', path: 'src/a.ts' }],
    sessionId,
  })
})

test('a turn start stamps its model selection, or the session one, on the user message', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  let state = createInitialChatProjectionSlice()
  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId })],
    updatedAt: timestamp(1),
  })
  state = applyChatProjectionEvent(state, userMessageEvent(sessionId))
  const sessionSelection = state.sessionById[sessionId]?.modelSelection
  state = applyChatProjectionEvent(state, {
    ...turnStartRequestedEvent(sessionId, turnId, parseProposedPlanId('plan-1')),
    sequence: 3,
  })

  expect(sessionSelection).toBeDefined()
  expect(
    state.messageBySessionId[sessionId]?.[parseMessageId('message-user')]?.modelSelection,
  ).toEqual(sessionSelection)
})

// The detail cursor is retained across a shell resnapshot, so the turn-start event that
// stamped this is never replayed: wiping it loses the plan banner until the next turn.
test('a shell resnapshot preserves the pending source proposed plan', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  const planId = parseProposedPlanId('plan-1')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId })],
    updatedAt: timestamp(1),
  })
  state = applyChatProjectionEvent(state, turnStartRequestedEvent(sessionId, turnId, planId))
  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 3,
    sessions: [
      makeSessionShell({
        id: sessionId,
        latestTurn: runningLatestTurn(turnId),
        updatedAt: timestamp(3),
      }),
    ],
    updatedAt: timestamp(3),
  })

  expect(state.sessionById[sessionId]?.pendingSourceProposedPlan).toEqual({
    planId,
    sessionId,
  })
})

// The server snapshot is authoritative after reconnect, including cleared pin state.
test('a shell resnapshot publishes the authoritative arranged pin slot', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId })],
    updatedAt: timestamp(1),
  })

  state = applyChatProjectionEvent(state, sessionPinnedEvent(sessionId, 'm'))

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 3,
    sessions: [makeSessionShell({ id: sessionId, updatedAt: timestamp(2) })],
    updatedAt: timestamp(2),
  })

  expect(state.sessionById[sessionId]?.pinOrderKey).toBeNull()
})

test('keeps published turns shell-owned while detail events update the live turn', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [
      makeSessionShell({
        id: sessionId,
        latestTurn: runningLatestTurn(turnId),
        updatedAt: timestamp(1),
      }),
    ],
    updatedAt: timestamp(1),
  })

  const publishedTurn = state.sessionById[sessionId]?.latestTurn
  state = applyChatProjectionEvent(state, assistantCompleteEvent(sessionId, turnId))

  expect(state.sessionById[sessionId]?.latestTurn).toBe(publishedTurn)
  expect(state.sessionById[sessionId]?.liveTurn).toMatchObject({
    assistantMessageId: parseMessageId('message-assistant'),
    completedAt: timestamp(4),
    state: 'completed',
    turnId,
  })
})

test('marks live provider turn failures as terminal in local turn state', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [
      makeSessionShell({
        id: sessionId,
        latestTurn: runningLatestTurn(turnId),
        updatedAt: timestamp(1),
      }),
    ],
    updatedAt: timestamp(1),
  })
  state = applyChatProjectionEvent(state, providerFailureActivityEvent(sessionId, turnId))

  expect(state.sessionById[sessionId]?.liveTurn).toMatchObject({
    completedAt: timestamp(5),
    state: 'error',
    turnId,
  })
})

test('projects streamed assistant deltas before completion without duplicating text', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-1')
  const messageId = parseMessageId('message-assistant')
  let state = createInitialChatProjectionSlice()

  state = syncChatProjectionShellSnapshot(state, {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [
      makeSessionShell({
        id: sessionId,
        latestTurn: { ...runningLatestTurn(turnId), startedAt: timestamp(1) },
        updatedAt: timestamp(1),
      }),
    ],
    updatedAt: timestamp(1),
  })
  state = applyChatProjectionEvent(
    state,
    assistantMessageEvent({
      messageId,
      sequence: 2,
      streaming: true,
      text: 'Hello ',
      sessionId,
      turnId,
    }),
  )
  state = applyChatProjectionEvent(
    state,
    assistantMessageEvent({
      messageId,
      sequence: 3,
      streaming: true,
      text: 'world',
      sessionId,
      turnId,
    }),
  )
  state = applyChatProjectionEvent(
    state,
    assistantMessageEvent({
      messageId,
      sequence: 4,
      streaming: false,
      text: '',
      sessionId,
      turnId,
    }),
  )

  expect(state.messageBySessionId[sessionId]?.[messageId]).toMatchObject({
    streaming: false,
    text: 'Hello world',
  })
  expect(state.sessionById[sessionId]?.liveTurn).toMatchObject({
    assistantMessageId: messageId,
    completedAt: timestamp(4),
    state: 'completed',
    turnId,
  })
})

test('projects the latest user message stamp before the next shell publish', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [makeProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell({ id: sessionId })],
    updatedAt: timestamp(1),
  })

  state = applyChatProjectionEvent(state, userMessageEvent(sessionId))

  expect(state.sessionById[sessionId]?.latestUserMessageAt).toBe(timestamp(2))
})

function makeDetailSnapshot({
  checkpoints = [],
  proposedPlans = [],
  snapshotSequence,
  session,
}: {
  checkpoints?: OrchestrationCheckpointSummary[]
  proposedPlans?: OrchestrationProposedPlan[]
  snapshotSequence: number
  session: OrchestrationSession
}): OrchestrationSessionDetailSnapshot {
  return { checkpoints, proposedPlans, snapshotSequence, session }
}

function makeProject(
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    ...fixtureProject(),
    createdAt: timestamp(0),
    defaultModelSelection: null,
    id: parseProjectId('609d2bd3-7993-5564-9918-c603beaa32c6'),
    orderKey: null,
    scripts: [],
    title: 'Project',
    updatedAt: timestamp(0),

    ...overrides,
  }
}

function makeSessionShell(
  overrides: Partial<OrchestrationSessionShell> = {},
): OrchestrationSessionShell {
  return {
    ...fixtureSessionShell(),
    archivedAt: null,

    createdAt: timestamp(0),
    hasActionableProposedPlan: false,
    id: parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb'),
    interactionMode: DEFAULT_INTERACTION_MODE,
    latestTurn: null,
    latestUserMessageAt: null,
    modelSelection: {
      model: 'codex-test',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    },
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,

    runtimeMode: DEFAULT_RUNTIME_MODE,
    runtime: null,
    title: 'Session',
    updatedAt: timestamp(0),

    ...overrides,
  }
}

function makeSessionDetail(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  return {
    deletion: null,
    ...makeSessionShell(overrides),
    activities: [],
    deletedAt: null,
    messages: [],
    ...overrides,
  }
}

function makeProposedPlan(
  overrides: Partial<OrchestrationProposedPlan> = {},
): OrchestrationProposedPlan {
  return {
    createdAt: timestamp(2),
    id: parseProposedPlanId('plan-1'),
    implementationSessionId: null,
    implementedAt: null,
    planMarkdown: '# Plan',
    sessionId: parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb'),
    turnId: null,
    updatedAt: timestamp(2),
    ...overrides,
  }
}

function makeCheckpoint(
  turnId: ReturnType<typeof parseTurnId>,
  overrides: Partial<OrchestrationCheckpointSummary> = {},
): OrchestrationCheckpointSummary {
  return {
    assistantMessageId: null,
    checkpointRef: 'checkpoint-1',
    checkpointTurnCount: 1,
    completedAt: timestamp(3),
    files: [{ additions: 3, deletions: 1, kind: 'modified', path: 'src/a.ts' }],
    status: 'ready',
    turnId,
    ...overrides,
  }
}

function runningLatestTurn(turnId: ReturnType<typeof parseTurnId>) {
  return {
    providerStartState: 'adopted' as const,
    providerStartGeneration: 1,
    providerStartSequence: 1,
    runtimeEpoch: 'test-epoch',
    assistantMessageId: null,
    completedAt: null,
    requestedAt: timestamp(1),
    startedAt: null,
    state: 'running',
    turnId,
  } as const
}

function makeMessage(
  index: number,
  sessionId: ReturnType<typeof parseSessionId>,
): OrchestrationMessage {
  return {
    attachments: [],
    createdAt: timestamp(index),
    id: parseMessageId(`message-${index}`),
    role: 'assistant',
    streaming: false,
    text: `message ${index}`,
    sessionId,
    turnId: null,
    updatedAt: timestamp(index),
  }
}

test('trims the oldest message when a streamed append crosses the cache limit', () => {
  const sessionId = parseSessionId('6bd01084-e7f5-5394-a5b7-a741d79008f3')
  const turnId = parseTurnId('turn-trim-messages')
  let state = createInitialChatProjectionSlice()

  // Sequences start at 1: `applySessionEventWithSequenceGuard` silently drops
  // an event whose sequence is not greater than the session's last one.
  for (let index = 1; index <= CHAT_MESSAGE_CACHE_LIMIT; index += 1) {
    state = applyChatProjectionEvent(
      state,
      assistantMessageEvent({
        messageId: parseMessageId(`message-${index}`),
        sequence: index,
        streaming: false,
        text: 'held',
        sessionId,
        turnId,
      }),
    )
  }
  state = applyChatProjectionEvent(
    state,
    assistantMessageEvent({
      messageId: parseMessageId('message-overflow'),
      sequence: CHAT_MESSAGE_CACHE_LIMIT + 1,
      streaming: false,
      text: 'overflow',
      sessionId,
      turnId,
    }),
  )

  const firstId = parseMessageId('message-1')
  expect(state.messageIdsBySessionId[sessionId]).toHaveLength(CHAT_MESSAGE_CACHE_LIMIT)
  expect(state.messageIdsBySessionId[sessionId]).not.toContain(firstId)
  expect(state.messageBySessionId[sessionId]?.[firstId]).toBeUndefined()
  expect(state.sessionHasEarlierById[sessionId]).toBe(true)
}, 30_000)

test('orders an out-of-sequence appended activity by sequence, not arrival', () => {
  const sessionId = parseSessionId('f0c28e51-0f0a-59da-a7da-1a6b3be9bb98')
  let state = createInitialChatProjectionSlice()

  for (const [eventSequence, activitySequence] of [
    [1, 1],
    [2, 3],
    [3, 2],
  ]) {
    state = applyChatProjectionEvent(
      state,
      activityAppendedEvent(
        sessionId,
        eventSequence,
        makeActivity(activitySequence, sessionId, { sequence: activitySequence }),
      ),
    )
  }

  expect(state.activityIdsBySessionId[sessionId]).toEqual([
    parseEventId('event-1'),
    parseEventId('event-2'),
    parseEventId('event-3'),
  ])
})

test('trims the oldest activity when an appended activity crosses the cache limit', () => {
  const sessionId = parseSessionId('d5aeaecc-96f1-5a6d-8bcb-2c2483ed44f4')
  let state = createInitialChatProjectionSlice()

  for (let index = 1; index <= CHAT_ACTIVITY_CACHE_LIMIT + 1; index += 1) {
    state = applyChatProjectionEvent(
      state,
      activityAppendedEvent(sessionId, index, makeActivity(index, sessionId, { sequence: index })),
    )
  }

  const firstId = parseEventId('event-1')
  expect(state.activityIdsBySessionId[sessionId]).toHaveLength(CHAT_ACTIVITY_CACHE_LIMIT)
  expect(state.activityIdsBySessionId[sessionId]).not.toContain(firstId)
  expect(state.activityBySessionId[sessionId]?.[firstId]).toBeUndefined()
  expect(state.sessionHasEarlierById[sessionId]).toBe(true)
}, 30_000)

function activityAppendedEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  eventSequence: number,
  activity: OrchestrationSessionActivity,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, eventSequence, `activity-${eventSequence}`),
    payload: { activity, sessionId },
    type: 'session.activity-appended',
  }
}

function makeActivity(
  index: number,
  sessionId: ReturnType<typeof parseSessionId>,
  overrides: Partial<OrchestrationSessionActivity> = {},
): OrchestrationSessionActivity {
  return {
    createdAt: timestamp(index),
    id: parseEventId(`event-${index}`),
    kind: 'tool',
    payload: null,
    sequence: index,
    summary: `activity ${index}`,
    sessionId,
    tone: 'tool',
    turnId: null,
    ...overrides,
  }
}

function sessionPinnedEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  pinOrderKey: string,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, 2, 'pinned'),
    payload: {
      pinOrderKey,
      pinnedAt: timestamp(2),
      sessionId,
      updatedAt: timestamp(2),
    },
    type: 'session.pinned',
  }
}

function makeSessionEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  sequence: number,
  slug: string,
): Omit<Extract<OrchestrationEvent, { type: 'session.message-sent' }>, 'payload' | 'type'> {
  return {
    actorKind: 'provider',
    aggregateId: sessionId,
    aggregateKind: 'session',
    causationEventId: null,
    commandId: parseCommandId(`command-${slug}`),
    correlationId: parseCommandId(`command-${slug}`),
    eventId: parseEventId(`event-${slug}`),
    metadata: {},
    occurredAt: timestamp(sequence),
    sequence,
  }
}

function assistantCompleteEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  turnId: ReturnType<typeof parseTurnId>,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, 2, 'assistant-complete'),
    occurredAt: timestamp(4),
    payload: {
      attachments: [],
      createdAt: timestamp(4),
      messageId: parseMessageId('message-assistant'),
      role: 'assistant',
      streaming: false,
      text: '',
      sessionId,
      turnId,
      updatedAt: timestamp(4),
    },
    type: 'session.message-sent',
  }
}

function userMessageEvent(sessionId: ReturnType<typeof parseSessionId>): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, 2, 'user-message'),
    payload: {
      attachments: [],
      createdAt: timestamp(2),
      messageId: parseMessageId('message-user'),
      role: 'user',
      streaming: false,
      text: 'Ship it',
      sessionId,
      turnId: null,
      updatedAt: timestamp(2),
    },
    type: 'session.message-sent',
  }
}

function assistantMessageEvent({
  messageId,
  sequence,
  streaming,
  text,
  sessionId,
  turnId,
}: {
  messageId: ReturnType<typeof parseMessageId>
  sequence: number
  streaming: boolean
  text: string
  sessionId: ReturnType<typeof parseSessionId>
  turnId: ReturnType<typeof parseTurnId>
}): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, sequence, `assistant-${sequence}`),
    payload: {
      attachments: [],
      createdAt: timestamp(sequence),
      messageId,
      role: 'assistant',
      streaming,
      text,
      sessionId,
      turnId,
      updatedAt: timestamp(sequence),
    },
    type: 'session.message-sent',
  }
}

function providerFailureActivityEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  turnId: ReturnType<typeof parseTurnId>,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, 3, 'provider-failure'),
    occurredAt: timestamp(5),
    payload: {
      activity: makeActivity(5, sessionId, {
        kind: 'provider.turn.start.failed',
        payload: { detail: 'failed' },
        summary: 'Provider turn start failed',
        tone: 'error',
        turnId,
      }),
      sessionId,
    },
    type: 'session.activity-appended',
  }
}

function proposedPlanUpsertedEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  planId: ReturnType<typeof parseProposedPlanId>,
  sequence: number,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, sequence, `plan-${sequence}`),
    payload: {
      proposedPlan: makeProposedPlan({ id: planId, sessionId }),
      sessionId,
    },
    type: 'session.proposed-plan-upserted',
  }
}

function turnDiffCompletedEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  turnId: ReturnType<typeof parseTurnId>,
  sequence: number,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, sequence, `turn-diff-${sequence}`),
    payload: {
      ...makeCheckpoint(turnId),
      sessionId,
    },
    type: 'session.turn-diff-completed',
  }
}

function turnStartRequestedEvent(
  sessionId: ReturnType<typeof parseSessionId>,
  turnId: ReturnType<typeof parseTurnId>,
  planId: ReturnType<typeof parseProposedPlanId>,
): OrchestrationEvent {
  return {
    ...makeSessionEvent(sessionId, 2, 'turn-start'),
    payload: {
      createdAt: timestamp(2),
      interactionMode: DEFAULT_INTERACTION_MODE,
      messageId: parseMessageId('message-user'),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      sourceProposedPlan: { planId, sessionId },
      sessionId,
      turnId,
    },
    type: 'session.turn-start-requested',
  }
}

function parseProjectId(value: string) {
  return v.parse(projectIdSchema, value)
}

function parseSessionId(value: string) {
  return v.parse(sessionIdSchema, value)
}

function parseMessageId(value: string) {
  return v.parse(messageIdSchema, value)
}

function parseEventId(value: string) {
  return v.parse(eventIdSchema, value)
}

function parseCommandId(value: string) {
  return v.parse(commandIdSchema, value)
}

function parseTurnId(value: string) {
  return v.parse(turnIdSchema, value)
}

function parseProposedPlanId(value: string) {
  return v.parse(proposedPlanIdSchema, value)
}

function timestamp(index: number) {
  return `2026-05-24T00:00:${String(index).padStart(2, '0')}.000Z`
}
