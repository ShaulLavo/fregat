import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  sessionIdSchema,
  eventIdSchema,
  commandIdSchema,
  type EnvironmentId,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationWsSessionDetailPageInput,
} from '@workspace/contracts'
import { afterEach, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import * as v from 'valibot'

import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createSessionEarlierPageLoader } from '@/features/chat/state/session-earlier-pages'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import {
  chatMessage,
  fixtureEnvironmentId,
  session as sessionFactory,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const SESSION_ID = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')

const loaders: ReturnType<typeof createSessionEarlierPageLoader>[] = []
let queryClient: QueryClient

afterEach(() => {
  for (const loader of loaders.splice(0)) loader.dispose()
  queryClient.clear()
})

beforeEach(() => {
  useChatProjectionStore.getState().resetChatProjection()
  queryClient = new QueryClient()
})

test('a page lands in front of the transcript and the boundary moves with it', async () => {
  seedFullWindow()
  const { loader, requests } = createLoader([page([message(0), message(1)], true)])

  expect(await loader.load(SESSION_ID)).toBe(true)

  expect(requests[0]?.beforeMessage?.id).toBe('message-2')
  expect(
    useChatProjectionStore.getState().slices[FIXTURE_ENVIRONMENT_ID]!.messageIdsBySessionId[
      SESSION_ID
    ]?.[0],
  ).toBe('message-0')
})

test('a landed page is not kept in the query cache beside the transcript', async () => {
  seedFullWindow()
  const { loader } = createLoader([page([message(0), message(1)], true)])
  loader.observer(SESSION_ID)

  expect(await loader.load(SESSION_ID)).toBe(true)

  await expect
    .poll(() =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['chat', 'earlier-page'] })
        .filter((query) => query.state.data !== undefined),
    )
    .toHaveLength(0)
})

test('two clicks in the same frame cost one scan', async () => {
  seedFullWindow()
  const { loader, requests } = createLoader([page([message(0)], true)])

  const [first, second] = await Promise.all([loader.load(SESSION_ID), loader.load(SESSION_ID)])

  expect(first).toBe(true)
  expect(second).toBe(true)
  expect(requests).toHaveLength(1)
})

test('an exhausted session is answered without touching the transport', async () => {
  seedFullWindow()
  const { loader, requests } = createLoader([page([message(0)], false)])
  await loader.load(SESSION_ID)

  expect(await loader.load(SESSION_ID)).toBe(false)
  expect(requests).toHaveLength(1)
})

test('a failed page is reported and stays retryable', async () => {
  seedFullWindow()
  const { loader, requests } = createLoader([new Error('offline'), page([message(0)], true)])

  expect(await loader.load(SESSION_ID)).toBe(false)
  expect(loader.observer(SESSION_ID).getCurrentResult()).toMatchObject({
    error: expect.objectContaining({ message: 'offline' }),
    isFetching: false,
  })

  expect(await loader.load(SESSION_ID)).toBe(true)
  expect(requests).toHaveLength(2)
  expect(loader.observer(SESSION_ID).getCurrentResult().error).toBeNull()
})

test('a page that turns out to be empty ends the walk instead of looping', async () => {
  seedFullWindow()
  const { loader, requests } = createLoader([page([], false)])

  expect(await loader.load(SESSION_ID)).toBe(true)
  expect(await loader.load(SESSION_ID)).toBe(false)
  expect(requests).toHaveLength(1)
})

test('disposing clears pending state and discards a late page', async () => {
  seedFullWindow()
  const response = Promise.withResolvers<OrchestrationSessionDetailPage>()
  const loader = createSessionEarlierPageLoader({
    queryClient,
    environmentId: FIXTURE_ENVIRONMENT_ID,
    transport: unsupportedChatTransport({ sessionDetailPage: () => response.promise }),
  })
  loaders.push(loader)
  const request = loader.load(SESSION_ID)
  expect(loader.observer(SESSION_ID).getCurrentResult().isFetching).toBe(true)

  loader.dispose()
  expect(loader.observer(SESSION_ID).getCurrentResult().isFetching).toBe(false)
  response.resolve(page([message(0)], true))

  expect(await request).toBe(false)
  expect(
    useChatProjectionStore.getState().slices[FIXTURE_ENVIRONMENT_ID]!.messageIdsBySessionId[
      SESSION_ID
    ]?.[0],
  ).toBe('message-2')
  expect(await loader.load(SESSION_ID)).toBe(false)
})

test('a live append preserves the captured page boundary and concurrent callers join it', async () => {
  seedFullWindow()
  const gate = Promise.withResolvers<OrchestrationSessionDetailPage>()
  const requests: OrchestrationWsSessionDetailPageInput[] = []
  const loader = deferredLoader((input) => {
    requests.push(input)
    return gate.promise
  })
  const first = loader.load(SESSION_ID)
  useChatProjectionStore.getState().applyOrchestrationEvent(FIXTURE_ENVIRONMENT_ID, liveMessage())
  const second = loader.load(SESSION_ID)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.beforeMessage?.id).toBe('message-2')
  gate.resolve(page([message(0), message(1)], false))
  expect(await Promise.all([first, second])).toEqual([true, true])
  const ids =
    useChatProjectionStore.getState().slices[FIXTURE_ENVIRONMENT_ID]?.messageIdsBySessionId[
      SESSION_ID
    ]
  expect(ids?.[0]).toBe('message-0')
  expect(ids?.at(-1)).toBe('message-999')
})

test('a reconnect snapshot replaces the page lifetime and ignores the old completion', async () => {
  seedFullWindow()
  const first = Promise.withResolvers<OrchestrationSessionDetailPage>()
  const second = Promise.withResolvers<OrchestrationSessionDetailPage>()
  const requests: OrchestrationWsSessionDetailPageInput[] = []
  const loader = deferredLoader((input) => {
    requests.push(input)
    return requests.length === 1 ? first.promise : second.promise
  })
  const oldRequest = loader.load(SESSION_ID)
  seedFullWindow(FIXTURE_ENVIRONMENT_ID, 500, 10)
  const newRequest = loader.load(SESSION_ID)
  expect(requests[1]?.beforeMessage?.id).toBe('message-500')
  second.resolve({ ...page([message(499)], false), snapshotSequence: 10 })
  expect(await newRequest).toBe(true)
  first.resolve(page([message(0)], true))
  expect(await oldRequest).toBe(false)
  const ids =
    useChatProjectionStore.getState().slices[FIXTURE_ENVIRONMENT_ID]?.messageIdsBySessionId[
      SESSION_ID
    ]
  expect(ids?.[0]).toBe('message-499')
  expect(ids).not.toContain('message-0')
  expect(loader.observer(SESSION_ID).getCurrentResult().isFetching).toBe(false)
})

test('equal session identifiers in separate environments never share a page or status', async () => {
  const other = fixtureEnvironmentId(2)
  seedFullWindow()
  seedFullWindow(other)
  const gate = Promise.withResolvers<OrchestrationSessionDetailPage>()
  const one = deferredLoader(() => gate.promise)
  const two = deferredLoader(async () => page([message(1)], false), other)
  const pending = one.load(SESSION_ID)
  expect(await two.load(SESSION_ID)).toBe(true)
  expect(one.observer(SESSION_ID).getCurrentResult().isFetching).toBe(true)
  expect(two.observer(SESSION_ID).getCurrentResult().isFetching).toBe(false)
  expect(
    useChatProjectionStore.getState().slices[FIXTURE_ENVIRONMENT_ID]?.messageIdsBySessionId[
      SESSION_ID
    ]?.[0],
  ).toBe('message-2')
  expect(
    useChatProjectionStore.getState().slices[other]?.messageIdsBySessionId[SESSION_ID]?.[0],
  ).toBe('message-1')
  gate.resolve(page([message(0)], false))
  expect(await pending).toBe(true)
})

function deferredLoader(
  read: (input: OrchestrationWsSessionDetailPageInput) => Promise<OrchestrationSessionDetailPage>,
  environmentId = FIXTURE_ENVIRONMENT_ID,
) {
  const loader = createSessionEarlierPageLoader({
    queryClient,
    environmentId,
    transport: { sessionDetailPage: read },
  })
  loaders.push(loader)
  return loader
}

function liveMessage(): OrchestrationEvent {
  const appended = message(999)
  return {
    type: 'session.message-sent',
    actorKind: 'provider',
    aggregateId: SESSION_ID,
    aggregateKind: 'session',
    causationEventId: null,
    commandId: v.parse(commandIdSchema, 'live-append'),
    correlationId: v.parse(commandIdSchema, 'live-append'),
    eventId: v.parse(eventIdSchema, 'live-append'),
    metadata: {},
    occurredAt: appended.createdAt,
    sequence: 2,
    payload: {
      attachments: [],
      createdAt: appended.createdAt,
      messageId: appended.id,
      role: 'assistant',
      streaming: false,
      text: 'live append',
      sessionId: SESSION_ID,
      turnId: null,
      updatedAt: appended.updatedAt,
    },
  }
}

function createLoader(script: Array<OrchestrationSessionDetailPage | Error>) {
  const requests: OrchestrationWsSessionDetailPageInput[] = []
  const loader = createSessionEarlierPageLoader({
    queryClient,
    environmentId: FIXTURE_ENVIRONMENT_ID,
    transport: unsupportedChatTransport({
      sessionDetailPage: async (input) => {
        const next = script[requests.length]
        requests.push(input)
        if (next instanceof Error) throw next
        if (!next) throw new Error('the loader asked for more pages than the test scripted')

        return next
      },
    }),
  })

  loaders.push(loader)
  return { loader, requests }
}

/** A window at the cap, which is the only state that offers a backwards page. */
function seedFullWindow(
  environmentId: EnvironmentId = FIXTURE_ENVIRONMENT_ID,
  offset = 2,
  sequence = 1,
) {
  useChatProjectionStore.getState().syncSessionDetailSnapshot(environmentId, {
    ...detailSnapshot(
      Array.from({ length: ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE }, (_, index) =>
        message(index + offset),
      ),
    ),
    snapshotSequence: sequence,
  })
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

function detailSnapshot(messages: OrchestrationMessage[]): OrchestrationSessionDetailSnapshot {
  return {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: { deletion: null, ...sessionFactory({ id: SESSION_ID, messages }), deletedAt: null },
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
