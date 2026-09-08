import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import {
  TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID,
  fixtureSessionId,
} from '../../../../../test/factories/chat'
import {
  commandIdSchema,
  eventIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationEvent,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'
import { afterEach, beforeEach } from 'vitest'
import * as v from 'valibot'

import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { applyChatProjectionEvent } from '@workspace/client-core/chat/writers'
import {
  hydrateSessionDiffScopeStoreFromStorage,
  useSessionDiffScopeStore,
} from '@/features/chat/state/session-diff-scope-store'
import {
  SESSION_DIFF_SCOPE_LIMIT,
  SESSION_DIFF_SCOPE_STORAGE_KEY,
} from '@/features/chat/utils/session-diff-scope-storage'
import { expect, test } from '../../../../../test/fixtures'

// The node project has no DOM, and the point of persistence is what crosses
// localStorage, so stand up a real Map-backed Storage rather than skipping it.
const STORE = new Map<string, string>()

function memoryLocalStorage(): Storage {
  return {
    get length() {
      return STORE.size
    },
    clear: () => STORE.clear(),
    getItem: (key: string) => STORE.get(key) ?? null,
    key: (index: number) => Array.from(STORE.keys())[index] ?? null,
    removeItem: (key: string) => void STORE.delete(key),
    setItem: (key: string, value: string) => void STORE.set(key, value),
  }
}

function scopeFor(sessionId: SessionId) {
  return useSessionDiffScopeStore.getState().scopeBySessionKey[
    `${FIXTURE_ENVIRONMENT_ID}:${sessionId}`
  ]?.scope
}

function parseSessionId(value: string) {
  return v.parse(sessionIdSchema, value)
}

function parseTurnId(value: string) {
  return v.parse(turnIdSchema, value)
}

function timestamp(index: number) {
  return `2026-06-01T00:00:${String(index).padStart(2, '0')}.000Z`
}

function sessionEvent(sessionId: SessionId, sequence: number, slug: string) {
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
    sequence,
  } as const satisfies Omit<
    Extract<OrchestrationEvent, { type: 'session.reverted' }>,
    'payload' | 'type'
  >
}

function turnDiffCompletedEvent(
  sessionId: SessionId,
  turnId: TurnId,
  checkpointTurnCount: number,
): OrchestrationEvent {
  return {
    ...sessionEvent(sessionId, checkpointTurnCount, `turn-diff-${checkpointTurnCount}`),
    payload: {
      assistantMessageId: null,
      checkpointRef: `checkpoint-${checkpointTurnCount}`,
      checkpointTurnCount,
      completedAt: timestamp(checkpointTurnCount),
      files: [{ additions: 3, deletions: 1, kind: 'modified', path: 'src/a.ts' }],
      status: 'ready',
      sessionId,
      turnId,
    },
    type: 'session.turn-diff-completed',
  }
}

function revertedEvent(sessionId: SessionId, turnCount: number): OrchestrationEvent {
  return {
    ...sessionEvent(sessionId, 90 + turnCount, `reverted-${turnCount}`),
    payload: { revertedAt: timestamp(30), sessionId, turnCount },
    type: 'session.reverted',
  }
}

/**
 * Three real checkpoints, then a real revert to the first — the client projection
 * drops every checkpoint past the reverted turn count exactly as the server's
 * `pruneSessionAfterRevert` does, so the list this returns is the pruned list the
 * reconcile has to survive.
 */
function turnIdsAfterRevert(sessionId: SessionId, turnIds: readonly TurnId[], turnCount: number) {
  let state = createInitialChatProjectionSlice()

  turnIds.forEach((turnId, index) => {
    state = applyChatProjectionEvent(state, turnDiffCompletedEvent(sessionId, turnId, index + 1))
  })
  state = applyChatProjectionEvent(state, revertedEvent(sessionId, turnCount))

  return state.turnDiffIdsBySessionId[sessionId] ?? []
}

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage(),
  })
  hydrateSessionDiffScopeStoreFromStorage(testScopedStorage)
})

afterEach(() => {
  STORE.clear()
  hydrateSessionDiffScopeStoreFromStorage(testScopedStorage)
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('a session starts with no remembered diff scope', () => {
  expect(scopeFor(parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb'))).toBeUndefined()
})

test('a picked scope survives a reload', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')

  useSessionDiffScopeStore
    .getState()
    .selectSessionDiffScope(
      { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
      { kind: 'working-tree' },
    )

  // What a fresh page load does: drop the in-memory map, read storage back.
  hydrateSessionDiffScopeStoreFromStorage(testScopedStorage)
  expect(scopeFor(sessionId)).toEqual({ kind: 'working-tree' })
})

test('junk in storage falls back to no remembered scope instead of throwing', () => {
  testScopedStorage.setItem(
    SESSION_DIFF_SCOPE_STORAGE_KEY,
    '{"scopeBySessionKey":{"ad686244-5b2e-59be-805f-ef86eac80feb":{"scope":42}}}',
  )

  hydrateSessionDiffScopeStoreFromStorage(testScopedStorage)
  expect(scopeFor(parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb'))).toBeUndefined()
})

test('the map is bounded, keeping the most recently picked sessions', () => {
  const { selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  for (let index = 0; index <= SESSION_DIFF_SCOPE_LIMIT; index += 1) {
    selectSessionDiffScope(
      { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId: fixtureSessionId(index + 1) },
      { kind: 'working-tree' },
    )
  }

  const stored = useSessionDiffScopeStore.getState().scopeBySessionKey
  expect(Object.keys(stored)).toHaveLength(SESSION_DIFF_SCOPE_LIMIT)
  expect(scopeFor(fixtureSessionId(1))).toBeUndefined()
  expect(scopeFor(fixtureSessionId(SESSION_DIFF_SCOPE_LIMIT + 1))).toBeDefined()
})

test('a turn pick a revert deleted reconciles to the nearest surviving turn', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnIds = [parseTurnId('turn-1'), parseTurnId('turn-2'), parseTurnId('turn-3')]
  const { reconcileTurnScope, selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  selectSessionDiffScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    { filePath: 'src/a.ts', kind: 'turn', turnId: turnIds[2]! },
  )

  // The revert keeps only turn 1, which is what the server prunes to as well.
  const survivingTurnIds = turnIdsAfterRevert(sessionId, turnIds, 1)
  expect(survivingTurnIds).toEqual([turnIds[0]])

  reconcileTurnScope({ environmentId: FIXTURE_ENVIRONMENT_ID, sessionId }, survivingTurnIds)
  expect(scopeFor(sessionId)).toEqual({ filePath: null, kind: 'turn', turnId: turnIds[0] })
})

test('a reconciled pick is what a reload reads back', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnIds = [parseTurnId('turn-1'), parseTurnId('turn-2'), parseTurnId('turn-3')]
  const { reconcileTurnScope, selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  selectSessionDiffScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    { filePath: null, kind: 'turn', turnId: turnIds[2]! },
  )
  reconcileTurnScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    turnIdsAfterRevert(sessionId, turnIds, 2),
  )

  hydrateSessionDiffScopeStoreFromStorage(testScopedStorage)
  expect(scopeFor(sessionId)).toEqual({ filePath: null, kind: 'turn', turnId: turnIds[1] })
})

test('a turn pick that survived the revert is left alone', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnIds = [parseTurnId('turn-1'), parseTurnId('turn-2'), parseTurnId('turn-3')]
  const { reconcileTurnScope, selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  selectSessionDiffScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    { filePath: 'src/a.ts', kind: 'turn', turnId: turnIds[0]! },
  )
  reconcileTurnScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    turnIdsAfterRevert(sessionId, turnIds, 2),
  )

  expect(scopeFor(sessionId)).toEqual({ filePath: 'src/a.ts', kind: 'turn', turnId: turnIds[0] })
})

// An empty list is a session whose detail has not arrived, and a cold start hits
// that on every reload. Treating it as "the turn is gone" would make the stored
// pick unusable by construction.
test('an unloaded session does not lose its turn pick', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnId = parseTurnId('turn-3')
  const { reconcileTurnScope, selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  selectSessionDiffScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    { filePath: null, kind: 'turn', turnId },
  )
  reconcileTurnScope({ environmentId: FIXTURE_ENVIRONMENT_ID, sessionId }, [])

  expect(scopeFor(sessionId)).toEqual({ filePath: null, kind: 'turn', turnId })
})

test('a working-tree pick is never touched by a revert', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  const turnIds = [parseTurnId('turn-1'), parseTurnId('turn-2')]
  const { reconcileTurnScope, selectSessionDiffScope } = useSessionDiffScopeStore.getState()

  selectSessionDiffScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    { kind: 'working-tree' },
  )
  reconcileTurnScope(
    { environmentId: FIXTURE_ENVIRONMENT_ID, sessionId },
    turnIdsAfterRevert(sessionId, turnIds, 1),
  )

  expect(scopeFor(sessionId)).toEqual({ kind: 'working-tree' })
})
