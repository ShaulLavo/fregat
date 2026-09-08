import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  eventIdSchema,
  orchestrationEventSchema,
  sessionIdSchema,
  type OrchestrationMessage,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import * as v from 'valibot'

import { CHAT_MESSAGE_CACHE_LIMIT } from '@workspace/client-core/chat/cache-constants'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import {
  chatSessionEarlierPageInput,
  selectChatSessionHasEarlier,
} from '@workspace/client-core/chat/selectors'
import {
  applyChatProjectionEvent,
  prependChatProjectionSessionDetailPage,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'
import {
  chatMessage,
  session as sessionFactory,
  sessionActivity,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const SESSION_ID = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')

test('a full detail window leaves earlier rows on the table, a short one does not', () => {
  const full = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot(windowMessages(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)),
  )
  const short = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot(windowMessages(3)),
  )

  expect(selectChatSessionHasEarlier(full, SESSION_ID)).toBe(true)
  expect(selectChatSessionHasEarlier(short, SESSION_ID)).toBe(false)
})

test('an unopened session offers the page rather than hiding reachable history', () => {
  expect(selectChatSessionHasEarlier(createInitialChatProjectionSlice(), SESSION_ID)).toBe(true)
})

test('the page request boundary is the oldest row the store still holds', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot([message(100), message(101)]),
  )

  expect(chatSessionEarlierPageInput(state, SESSION_ID)).toEqual({
    beforeActivity: null,
    beforeMessage: { createdAt: createdAt(100), id: 'message-100' },
    sessionId: SESSION_ID,
  })

  state = prependChatProjectionSessionDetailPage(state, page([message(98), message(99)], true))

  expect(chatSessionEarlierPageInput(state, SESSION_ID)).toEqual({
    beforeActivity: null,
    beforeMessage: { createdAt: createdAt(98), id: 'message-98' },
    sessionId: SESSION_ID,
  })
})

test('paging backwards prepends older turns in order and terminates on the last page', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot([message(4), message(5)]),
  )

  state = prependChatProjectionSessionDetailPage(state, page([message(2), message(3)], true))
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(true)

  state = prependChatProjectionSessionDetailPage(state, page([message(0), message(1)], false))

  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual([
    'message-0',
    'message-1',
    'message-2',
    'message-3',
    'message-4',
    'message-5',
  ])
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(false)
})

test('a page that overlaps the window is idempotent instead of duplicating rows', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot([message(2), message(3)]),
  )

  state = prependChatProjectionSessionDetailPage(state, page([message(1), message(2)], false))
  state = prependChatProjectionSessionDetailPage(state, page([message(1), message(2)], false))

  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual(['message-1', 'message-2', 'message-3'])
})

test('a live append that trims the front re-arms the page so trimmed rows stay reachable', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot(windowMessages(3)),
  )
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(false)

  // Fill past the cache ceiling, then let one more live message trim the front.
  state = prependChatProjectionSessionDetailPage(
    state,
    page(
      Array.from({ length: CHAT_MESSAGE_CACHE_LIMIT }, (_, index) => message(1_000 + index)),
      false,
    ),
  )
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(false)

  state = applyChatProjectionEvent(state, messageSentEvent(message(9_999), 42))

  expect(state.messageIdsBySessionId[SESSION_ID]).toHaveLength(CHAT_MESSAGE_CACHE_LIMIT + 3)
  expect(state.messageIdsBySessionId[SESSION_ID]?.[0]).toBe('message-1001')
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(true)
  // The re-armed boundary points at the new oldest row, so the trimmed message
  // is exactly one page request away.
  expect(chatSessionEarlierPageInput(state, SESSION_ID).beforeMessage).toEqual({
    createdAt: createdAt(1_001),
    id: 'message-1001',
  })
})

test('a latest snapshot preserves loaded message and activity pages beyond the live cache limit', () => {
  const messages = windowMessages(CHAT_MESSAGE_CACHE_LIMIT + 4)
  const activities = messages.map((message, index) =>
    sessionActivity({
      id: v.parse(eventIdSchema, `activity-${index}`),
      sessionId: SESSION_ID,
      createdAt: message.createdAt,
    }),
  )
  const snapshot = detailSnapshot(
    messages.slice(-ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE),
    activities.slice(-ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE),
  )
  let state = syncChatProjectionSessionDetailSnapshot(createInitialChatProjectionSlice(), snapshot)
  state = prependChatProjectionSessionDetailPage(state, {
    ...page(messages, false),
    activities,
  })
  const before = state
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    { ...snapshot, snapshotSequence: 2 },
    'reconcile',
  )
  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual(before.messageIdsBySessionId[SESSION_ID])
  expect(state.activityIdsBySessionId[SESSION_ID]).toEqual(
    before.activityIdsBySessionId[SESSION_ID],
  )
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(false)
})

test('a shortened snapshot removes rows that are no longer in the history', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot(windowMessages(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)),
  )
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    {
      ...detailSnapshot(windowMessages(3)),
      snapshotSequence: 2,
    },
    'reconcile',
  )
  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual(['message-0', 'message-1', 'message-2'])
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(false)
})

test('a snapshot without overlap discards disconnected pages and offers earlier history again', () => {
  let state = syncChatProjectionSessionDetailSnapshot(
    createInitialChatProjectionSlice(),
    detailSnapshot(windowMessages(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE)),
  )
  state = prependChatProjectionSessionDetailPage(state, page([], false))
  const incoming = Array.from({ length: ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE }, (_, index) =>
    message(1000 + index),
  )
  state = syncChatProjectionSessionDetailSnapshot(
    state,
    {
      ...detailSnapshot(incoming),
      snapshotSequence: 2,
    },
    'reconcile',
  )
  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual(incoming.map((row) => row.id))
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(true)
})

test('an authoritative snapshot invalidates older pages even when its boundary still overlaps', () => {
  const messages = windowMessages(ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 3)
  const snapshot = detailSnapshot(messages.slice(3))
  let state = syncChatProjectionSessionDetailSnapshot(createInitialChatProjectionSlice(), snapshot)
  state = prependChatProjectionSessionDetailPage(state, page(messages.slice(0, 3), false))
  state = syncChatProjectionSessionDetailSnapshot(state, { ...snapshot, snapshotSequence: 2 })
  expect(state.messageIdsBySessionId[SESSION_ID]).toEqual(
    snapshot.session.messages.map((row) => row.id),
  )
  expect(selectChatSessionHasEarlier(state, SESSION_ID)).toBe(true)
})

function windowMessages(count: number) {
  return Array.from({ length: count }, (_, index) => message(index))
}

function message(index: number): OrchestrationMessage {
  return chatMessage({
    createdAt: createdAt(index),
    id: `message-${index}` as OrchestrationMessage['id'],
    sessionId: SESSION_ID,
    updatedAt: createdAt(index),
  })
}

function createdAt(index: number) {
  return new Date(Date.UTC(2026, 4, 24) + index * 1_000).toISOString()
}

function detailSnapshot(
  messages: OrchestrationMessage[],
  activities: OrchestrationSessionActivity[] = [],
): OrchestrationSessionDetailSnapshot {
  return {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: {
      deletion: null,
      ...sessionFactory({ id: SESSION_ID, messages, activities }),
      deletedAt: null,
    },
  }
}

function page(
  messages: OrchestrationMessage[],
  hasEarlier: boolean,
): OrchestrationSessionDetailPage {
  return {
    activities: [],
    hasEarlier,
    messages,
    snapshotSequence: 1,
    sessionId: SESSION_ID,
  }
}

function messageSentEvent(message: OrchestrationMessage, sequence: number) {
  return v.parse(orchestrationEventSchema, {
    actorKind: 'client',
    aggregateId: SESSION_ID,
    aggregateKind: 'session',
    causationEventId: null,
    commandId: null,
    correlationId: null,
    eventId: `event-${message.id}`,
    metadata: {},
    occurredAt: message.createdAt,
    payload: {
      attachments: [],
      createdAt: message.createdAt,
      messageId: message.id,
      role: message.role,
      streaming: false,
      text: message.text,
      sessionId: SESSION_ID,
      turnId: null,
      updatedAt: message.updatedAt,
    },
    sequence,
    type: 'session.message-sent',
  })
}
