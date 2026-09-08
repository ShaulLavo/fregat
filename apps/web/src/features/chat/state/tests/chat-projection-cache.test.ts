import { hydrateEnvironmentChatCache } from '@/features/chat/state/chat-projection-store'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { selectChatProjectionSlice } from '@/features/chat/state/chat-projection-store'
import { fixtureSessionId } from '../../../../../test/factories/chat'
import {
  TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID,
  chatWorktree as fixtureWorktree,
  sessionShell as fixtureSessionShell,
} from '../../../../../test/factories/chat'
import {
  messageIdSchema,
  sessionIdSchema,
  type MessageId,
  type OrchestrationSession,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionShell,
  type SessionId,
} from '@workspace/contracts'
import { afterEach, beforeEach } from 'vitest'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'
import { chatMessage, shellSnapshot, sessionShell } from '../../../../../test/factories/chat'
import {
  CHAT_PROJECTION_CACHE_MESSAGE_LIMIT,
  CHAT_PROJECTION_CACHE_SESSION_LIMIT,
  CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT,
} from '@workspace/client-core/chat/cache-constants'
import {
  CHAT_PROJECTION_CACHE_STORAGE_KEY,
  chatProjectionCacheFromState,
  readChatProjectionCache,
} from '@/features/chat/state/chat-projection-cache'
import {
  selectChatSidebarSessions,
  selectChatSessionById,
} from '@workspace/client-core/chat/selectors'
import {
  flushChatProjectionCache,
  restoredChatProjectionState,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'

const STORE = new Map<string, string>()

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: fakeLocalStorage(),
  })
  useChatProjectionStore.getState().resetChatProjection()
  hydrateEnvironmentChatCache(testScopedStorage)
})

afterEach(() => {
  useChatProjectionStore.getState().resetChatProjection()
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('a cold reload paints the shell and the open transcript from cache, then reconciles to server truth', () => {
  const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
  useChatProjectionStore.getState().syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, shellSnapshot())
  useChatProjectionStore
    .getState()
    .syncSessionDetailSnapshot(
      FIXTURE_ENVIRONMENT_ID,
      sessionDetailSnapshot(sessionShell(), [
        chatMessage({ id: parseMessageId('message-1'), text: 'cached question' }),
        chatMessage({ id: parseMessageId('message-2'), text: 'cached answer' }),
      ]),
    )
  expect(flushChatProjectionCache()).toBe(true)

  // What the next process sees before any socket has connected.
  const painted = selectChatProjectionSlice(
    restoredChatProjectionState(testScopedStorage),
    FIXTURE_ENVIRONMENT_ID,
  )

  expect(selectChatSidebarSessions(painted).map((session) => session.title)).toEqual(['Session'])
  expect(
    selectChatSessionById(painted, sessionId)?.messages.map((message) => message.text),
  ).toEqual(['cached question', 'cached answer'])
  // Nothing has been served yet, so the cache must not claim any served ground.
  expect(painted.bootstrapComplete).toBe(false)
  expect(painted.lastAppliedShellSequence).toBe(0)
  expect(painted.sessionDetailSequenceById).toEqual({})

  const reconciled = syncChatProjectionShellSnapshot(painted, {
    ...shellSnapshot({ sessions: [sessionShell({ title: 'Renamed on the server' })] }),
    snapshotSequence: 7,
  })

  expect(selectChatSidebarSessions(reconciled).map((session) => session.title)).toEqual([
    'Renamed on the server',
  ])
  expect(reconciled.bootstrapComplete).toBe(true)
  expect(reconciled.lastAppliedShellSequence).toBe(7)
})

test('a version mismatch drops the cache instead of half-reading it', () => {
  useChatProjectionStore.getState().syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, shellSnapshot())
  expect(flushChatProjectionCache()).toBe(true)

  const stored = JSON.parse(testScopedStorage.getItem(CHAT_PROJECTION_CACHE_STORAGE_KEY) ?? '{}')
  testScopedStorage.setItem(
    CHAT_PROJECTION_CACHE_STORAGE_KEY,
    JSON.stringify({ ...stored, version: stored.version + 1 }),
  )

  expect(readChatProjectionCache(testScopedStorage)).toBeNull()
  expect(scopedHas(CHAT_PROJECTION_CACHE_STORAGE_KEY)).toBe(false)
  expect(
    selectChatProjectionSlice(
      restoredChatProjectionState(testScopedStorage),
      FIXTURE_ENVIRONMENT_ID,
    ).projectIds,
  ).toEqual([])
})

test('the painted snapshot is bounded by session, transcript and message capacity', () => {
  const sessions = Array.from(
    { length: CHAT_PROJECTION_CACHE_SESSION_LIMIT + 5 },
    (_unused, index) =>
      sessionShell({ id: fixtureSessionId(index + 1), title: `Session ${index}` }),
  )
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, shellSnapshot({ sessions }))

  for (const shell of sessions.slice(0, CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT + 2)) {
    useChatProjectionStore.getState().syncSessionDetailSnapshot(
      FIXTURE_ENVIRONMENT_ID,
      sessionDetailSnapshot(
        shell,
        Array.from({ length: CHAT_PROJECTION_CACHE_MESSAGE_LIMIT + 10 }, (_unused, index) =>
          chatMessage({ id: parseMessageId(`${shell.id}-message-${index}`), sessionId: shell.id }),
        ),
      ),
    )
  }

  const cached = chatProjectionCacheFromState(useChatProjectionStore.getState())

  expect(cached.slices[0]?.sessions).toHaveLength(CHAT_PROJECTION_CACHE_SESSION_LIMIT)
  expect(cached.slices[0]!.transcripts).toHaveLength(CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT)
  for (const transcript of cached.slices[0]!.transcripts) {
    expect(transcript.messages).toHaveLength(CHAT_PROJECTION_CACHE_MESSAGE_LIMIT)
  }
})

test('a transcript whose session fell out of the cached shell is skipped, not half-applied', () => {
  const kept = sessionShell({ id: parseSessionId('c3bccae3-33fd-5e8b-b82d-182a8ec13bb2') })
  const dropped = sessionShell({ id: parseSessionId('87dacaf6-1a6a-5edb-b892-47ce3339ca9b') })
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, shellSnapshot({ sessions: [kept, dropped] }))
  useChatProjectionStore
    .getState()
    .syncSessionDetailSnapshot(
      FIXTURE_ENVIRONMENT_ID,
      sessionDetailSnapshot(dropped, [chatMessage({ id: parseMessageId('message-1') })]),
    )

  const cached = chatProjectionCacheFromState(useChatProjectionStore.getState())
  const withoutSession = {
    ...cached,
    slices: cached.slices.map((slice) => ({ ...slice, sessions: [kept] })),
  }
  testScopedStorage.setItem(CHAT_PROJECTION_CACHE_STORAGE_KEY, JSON.stringify(withoutSession))

  const painted = selectChatProjectionSlice(
    restoredChatProjectionState(testScopedStorage),
    FIXTURE_ENVIRONMENT_ID,
  )

  expect(painted.sessionIds).toEqual([kept.id])
  expect(painted.messageIdsBySessionId).toEqual({})
})

test('an empty projection is cacheable and restores to an empty shell', () => {
  useChatProjectionStore
    .getState()
    .syncShellSnapshot(
      FIXTURE_ENVIRONMENT_ID,
      shellSnapshot({ worktrees: [fixtureWorktree()], projects: [], sessions: [] }),
    )
  expect(flushChatProjectionCache()).toBe(true)

  const painted = selectChatProjectionSlice(
    restoredChatProjectionState(testScopedStorage),
    FIXTURE_ENVIRONMENT_ID,
  )

  expect(painted.projectIds).toEqual([])
  expect(painted.sessionIds).toEqual([])
})

function sessionDetailSnapshot(
  shell: OrchestrationSessionShell,
  messages: OrchestrationSession['messages'],
): OrchestrationSessionDetailSnapshot {
  return {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: {
      deletion: null,
      ...fixtureSessionShell(),
      activities: [],
      archivedAt: shell.archivedAt,

      createdAt: shell.createdAt,
      deletedAt: null,
      id: shell.id,
      interactionMode: shell.interactionMode,
      latestTurn: shell.latestTurn,
      messages,
      modelSelection: shell.modelSelection,

      runtimeMode: shell.runtimeMode,
      runtime: shell.runtime,
      title: shell.title,
      updatedAt: shell.updatedAt,
    },
  }
}

function parseSessionId(value: string): SessionId {
  return v.parse(sessionIdSchema, value)
}

function parseMessageId(value: string): MessageId {
  return v.parse(messageIdSchema, value)
}

function fakeLocalStorage(): Storage {
  return {
    clear: () => STORE.clear(),
    getItem: (key: string) => STORE.get(key) ?? null,
    key: (index: number) => Array.from(STORE.keys())[index] ?? null,
    get length() {
      return STORE.size
    },
    removeItem: (key: string) => {
      STORE.delete(key)
    },
    setItem: (key: string, value: string) => {
      STORE.set(key, value)
    },
  }
}

function scopedHas(key: string) {
  return testScopedStorage.getItem(key) !== null
}
