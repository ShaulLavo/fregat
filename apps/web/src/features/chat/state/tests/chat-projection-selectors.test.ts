import { chatProject, fixtureSessionId } from '../../../../../test/factories/chat'
import {
  chatWorktree as fixtureWorktree,
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
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationSessionShell,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  createChatSessionListSelector,
  selectChatSidebarSessions,
  selectChatSidebarSessionsForProject,
  selectChatSessionById,
} from '@workspace/client-core/chat/selectors'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import {
  applyChatProjectionEvent,
  syncChatProjectionShellSnapshot,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'
import { sessionShell } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const projectId = v.parse(projectIdSchema, '609d2bd3-7993-5564-9918-c603beaa32c6')

test('derives terminal turn state from terminal session state', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = v.parse(turnIdSchema, 'turn-1')
  const state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [makeSessionShell(sessionId, turnId)],
    updatedAt: timestamp(2),
  })

  expect(selectChatSessionById(state, sessionId)?.latestTurn).toMatchObject({
    completedAt: timestamp(2),
    state: 'error',
    turnId,
  })
})

test('an archived session is not a sidebar session, project-scoped or not', () => {
  const state = sidebarState()

  expect(selectChatSidebarSessions(state).map((session) => session.id)).toEqual([
    '1cb66ded-870c-5359-8e74-f911ce864e73',
  ])
  expect(
    selectChatSidebarSessionsForProject(state, projectId).map((session) => session.id),
  ).toEqual(['1cb66ded-870c-5359-8e74-f911ce864e73'])
})

// These feed zustand selectors: a fresh array per read is a render loop, not a detail.
test('sidebar session lists keep their identity across reads', () => {
  const state = sidebarState()

  expect(selectChatSidebarSessions(state)).toBe(selectChatSidebarSessions(state))
  expect(selectChatSidebarSessionsForProject(state, projectId)).toBe(
    selectChatSidebarSessionsForProject(state, projectId),
  )
})

// Shell and detail subscriptions are independent, so a detail cached before a reconnect
// can land after a newer shell snapshot. Targeting a stale checkout is a real hazard.
test('a late detail snapshot cannot revert newer shell metadata', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const shell = sessionShell({
    id: sessionId,
    title: 'shell title',
  })
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [shell],
    updatedAt: timestamp(2),
  })

  state = syncChatProjectionSessionDetailSnapshot(state, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 2,
    session: staleDetailSession(sessionId),
  })

  expect(selectChatSessionById(state, sessionId)).toMatchObject({
    runtime: shell.runtime,
    title: 'shell title',
  })
})

test('a detail snapshot cannot resolve a session before its checkout ownership arrives', () => {
  const sessionId = fixtureSessionId(1)
  const state = syncChatProjectionSessionDetailSnapshot(createInitialChatProjectionSlice(), {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: staleDetailSession(sessionId),
  })
  expect(selectChatSessionById(state, sessionId)).toBeUndefined()
})

// `null` is a real session value — "the session stopped" — so the merge decides by
// presence, not truthiness. A shell that published a stopped session must outrank a
// detail snapshot that still remembers a running one, or the composer offers to
// interrupt a session that is already gone.
test('a published null session outranks a detail snapshot that still carries one', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const shell = sessionShell({ id: sessionId, runtime: null })
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [shell],
    updatedAt: timestamp(2),
  })

  state = syncChatProjectionSessionDetailSnapshot(state, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 2,
    session: { ...staleDetailSession(sessionId), runtime: sessionShell().runtime },
  })

  expect(selectChatSessionById(state, sessionId)?.runtime).toBeNull()
})

// The turn falls back by *value*, not by presence: a session the shell delivered with
// no turn at all still shows the turn its detail snapshot carried, which is what a
// cold open of an idle-looking session depends on.
test('a session with no published turn still shows the turn its detail snapshot carried', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = v.parse(turnIdSchema, 'turn-1')
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [sessionShell({ id: sessionId, latestTurn: null, runtime: null })],
    updatedAt: timestamp(2),
  })

  state = syncChatProjectionSessionDetailSnapshot(state, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 2,
    session: {
      ...staleDetailSession(sessionId),
      latestTurn: {
        providerStartState: 'adopted' as const,
        providerStartGeneration: 1,
        providerStartSequence: 1,
        runtimeEpoch: 'test-epoch',
        assistantMessageId: null,
        completedAt: timestamp(3),
        requestedAt: timestamp(1),
        startedAt: timestamp(2),
        state: 'completed',
        turnId,
      },
    },
  })

  expect(selectChatSessionById(state, sessionId)?.latestTurn).toMatchObject({
    state: 'completed',
    turnId,
  })
})

test('a newer detail snapshot replaces the live turn from the previous snapshot', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const firstTurnId = v.parse(turnIdSchema, 'turn-1')
  const secondTurnId = v.parse(turnIdSchema, 'turn-2')
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [sessionShell({ id: sessionId, latestTurn: null, runtime: null })],
    updatedAt: timestamp(1),
  })

  state = syncChatProjectionSessionDetailSnapshot(state, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 2,
    session: { ...staleDetailSession(sessionId), latestTurn: completedTurn(firstTurnId, 2) },
  })
  state = syncChatProjectionSessionDetailSnapshot(state, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 3,
    session: { ...staleDetailSession(sessionId), latestTurn: completedTurn(secondTurnId, 3) },
  })

  expect(selectChatSessionById(state, sessionId)?.latestTurn).toMatchObject({
    completedAt: timestamp(3),
    turnId: secondTurnId,
  })
})

test('a populated list projection stays stable across streamed token deltas', () => {
  const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = v.parse(turnIdSchema, 'turn-1')
  const sessions = Array.from({ length: 64 }, (_, index) =>
    sessionShell({
      id: fixtureSessionId(index + 1),
      title: `Session ${index + 1}`,
    }),
  )
  let state = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    projects: [chatProject()],
    snapshotSequence: 1,
    worktrees: [fixtureWorktree()],
    sessions,
    updatedAt: timestamp(1),
  })
  const selectList = createChatSessionListSelector({ includeArchived: true })
  const before = selectList(state)
  const canonicalBefore = state.sessionById[sessionId]

  for (let sequence = 2; sequence <= 20; sequence += 1) {
    state = applyChatProjectionEvent(state, streamedAssistantDelta(sessionId, turnId, sequence))
  }

  expect(state.sessionById[sessionId]).not.toBe(canonicalBefore)
  expect(state.sessionById[sessionId]?.updatedAt).toBe(timestamp(20))
  expect(selectList(state)).toBe(before)
})

function completedTurn(turnId: TurnId, completedAt: number) {
  return {
    providerStartState: 'adopted' as const,
    providerStartGeneration: 1,
    providerStartSequence: 1,
    runtimeEpoch: 'test-epoch',
    assistantMessageId: null,
    completedAt: timestamp(completedAt),
    requestedAt: timestamp(completedAt - 1),
    startedAt: timestamp(completedAt - 1),
    state: 'completed' as const,
    turnId,
  }
}

function streamedAssistantDelta(
  sessionId: SessionId,
  turnId: TurnId,
  sequence: number,
): OrchestrationEvent {
  const slug = `token-${sequence}`

  return {
    actorKind: 'provider',
    aggregateId: sessionId,
    aggregateKind: 'session',
    causationEventId: null,
    commandId: v.parse(commandIdSchema, `command-${slug}`),
    correlationId: v.parse(commandIdSchema, `command-${slug}`),
    eventId: v.parse(eventIdSchema, `event-${slug}`),
    metadata: {},
    occurredAt: timestamp(sequence),
    payload: {
      attachments: [],
      createdAt: timestamp(2),
      messageId: v.parse(messageIdSchema, 'message-streaming'),
      role: 'assistant',
      streaming: true,
      text: 'x',
      sessionId,
      turnId,
      updatedAt: timestamp(sequence),
    },
    sequence,
    type: 'session.message-sent',
  }
}

function staleDetailSession(sessionId: SessionId): OrchestrationSession {
  const source = sessionShell({ id: sessionId })

  return {
    deletion: null,
    ...source,
    activities: [],
    deletedAt: null,
    messages: [],
    runtime: null,
    title: 'stale detail title',
  }
}

function sidebarState() {
  return syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    worktrees: [fixtureWorktree()],
    projects: [chatProject()],
    snapshotSequence: 1,
    sessions: [
      sessionShell({
        archivedAt: timestamp(3),
        id: v.parse(sessionIdSchema, 'bddfb36f-ebed-581b-aec7-4e191ed2a817'),
      }),
      sessionShell({ id: v.parse(sessionIdSchema, '1cb66ded-870c-5359-8e74-f911ce864e73') }),
    ],
    updatedAt: timestamp(2),
  })
}

function makeSessionShell(sessionId: SessionId, turnId: TurnId): OrchestrationSessionShell {
  return {
    ...fixtureSessionShell(),
    archivedAt: null,

    createdAt: timestamp(1),
    hasActionableProposedPlan: false,
    id: sessionId,
    interactionMode: DEFAULT_INTERACTION_MODE,
    latestTurn: {
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
    },
    latestUserMessageAt: timestamp(1),
    modelSelection: {
      model: 'codex-test',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    },
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    runtime: {
      providerResumeCursor: null,
      providerConversationMarker: null,
      runtimeEpoch: 'test-epoch',
      activeTurnId: turnId,
      lastError: 'failed',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      providerName: 'Codex',
      providerBindingHandle: null,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      status: 'error',
      sessionId,
      updatedAt: timestamp(2),
    },
    title: 'Session',
    updatedAt: timestamp(2),
  }
}

function timestamp(index: number) {
  return `2026-05-28T00:00:0${index}.000Z`
}
