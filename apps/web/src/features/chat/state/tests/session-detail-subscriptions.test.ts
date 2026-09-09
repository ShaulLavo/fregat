import { fixtureSessionId } from '../../../../../test/factories/chat'
import { TEST_ENVIRONMENT_ID as FIXTURE_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  sessionIdSchema,
  type ClientOrchestrationCommand,
  type OrchestrationReplayEventsInput,
  type OrchestrationReplayEventsResult,
  type OrchestrationShellStreamItem,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionStreamItem,
  type SessionId,
} from '@workspace/contracts'
import { beforeEach, describe } from 'vitest'
import * as v from 'valibot'

import { createClientError } from '@workspace/client-core/errors'
import { expect, test } from '../../../../../test/fixtures'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { shellSnapshot, sessionShell } from '../../../../../test/factories/chat'
import { useChatProjectionStore } from '../chat-projection-store'
import { selectSessionDetailSync, useSessionDetailSyncStore } from '../session-detail-sync-store'
import { createSessionDetailSubscriptionCache } from '../session-detail-subscriptions'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  commandIdSchema,
} from '@workspace/contracts'

type ScriptedAttempt = {
  /** Thrown after the attempt's items. Omit to hang until aborted. */
  fail?: unknown
  items?: OrchestrationSessionStreamItem[]
}

describe('session detail subscription cache', () => {
  beforeEach(() => {
    useChatProjectionStore.getState().resetChatProjection()
    useSessionDetailSyncStore.setState({ syncBySessionId: {} })
  })

  test('retains one active stream per session and evicts after final release', async () => {
    const fake = createFakeEnvironment()
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')

    const releaseFirst = cache.retain(sessionId)
    const releaseSecond = cache.retain(sessionId)

    expect(fake.attempts.map((attempt) => attempt.sessionId)).toEqual([sessionId])
    expect(cache.snapshot()[0]?.refCount).toBe(2)

    releaseFirst()
    expect(cache.snapshot()[0]?.refCount).toBe(1)
    expect(timers.size()).toBe(0)

    releaseSecond()
    expect(cache.snapshot()[0]?.refCount).toBe(0)
    expect(timers.size()).toBe(1)
    await tick()
    expect(fake.aborts).toEqual([])

    timers.runAll()
    await tick()

    expect(cache.size()).toBe(0)
    expect(fake.aborts).toEqual([sessionId])

    cache.disposeAll()
  })

  test('protects running and actionable sessions from idle eviction', () => {
    const fake = createFakeEnvironment()
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')

    // The shared factory session is mid-run, which is exactly the protected shape.
    useChatProjectionStore
      .getState()
      .syncShellSnapshot(
        FIXTURE_ENVIRONMENT_ID,
        shellSnapshot({ sessions: [sessionShell({ id: sessionId })] }),
      )

    const release = cache.retain(sessionId)
    release()

    expect(cache.size()).toBe(1)
    expect(cache.snapshot()[0]?.hasEvictionTimer).toBe(false)
    expect(timers.size()).toBe(0)

    cache.disposeAll()
  })

  test('evicts the oldest idle entries when the cache exceeds capacity', async () => {
    const fake = createFakeEnvironment()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      maxCachedSubscriptions: 2,
      now: incrementingClock(),
    })
    const firstSessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const secondSessionId = parseSessionId('83820f69-dec0-53d9-9ab5-fddbd1dabb2d')
    const thirdSessionId = parseSessionId('69f6738e-3be7-5d20-b0c0-e5208a05ac64')

    cache.retain(firstSessionId)()
    cache.retain(secondSessionId)()
    cache.retain(thirdSessionId)()

    await tick()

    expect(cache.size()).toBe(2)
    expect(cache.snapshot().map((entry) => entry.sessionId)).toEqual([
      secondSessionId,
      thirdSessionId,
    ])
    expect(fake.aborts).toEqual([firstSessionId])

    cache.disposeAll()
  })

  test('reconnects after a stream error and resumes from the applied sequence', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const fake = createFakeEnvironment([
      {
        fail: streamFailure(),
        items: [{ kind: 'snapshot', snapshot: detailSnapshot(sessionId, 7) }],
      },
    ])
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })

    cache.retain(sessionId)
    await tick()

    expect(cache.snapshot()[0]?.status).toBe('reconnecting')
    expect(timers.delays()).toEqual([250])

    timers.runAll()
    await tick()

    expect(fake.attempts.map((attempt) => attempt.afterSequence)).toEqual([0, 7])
    expect(cache.snapshot()[0]?.active).toBe(true)

    cache.disposeAll()
  })

  test('marks a caught-up real session stream live without another data frame', async ({
    server,
  }) => {
    const rpc = createOrchestrationRpcClient({
      origin: server.origin,
      createSocket: inProcessOrchestrationSocketFactory({
        app: server.app,
        clientOrigin: server.origin,
      }),
    })
    const sessionId = fixtureSessionId(41)
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: rpc,
    })

    try {
      const registration = await rpc.dispatchCommand(
        createWorkspaceProjectCommand({ rootPath: server.root }),
      )
      expect(registration.result).not.toBeNull()
      await rpc.dispatchCommand({
        type: 'session.create',
        commandId: v.parse(commandIdSchema, 'create-caught-up-session'),
        sessionId,
        worktreeTarget: { kind: 'current', worktreeId: registration.result!.worktreeId },
        title: 'Caught up',
        modelSelection: { model: 'mock-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
        interactionMode: DEFAULT_INTERACTION_MODE,
        runtimeMode: DEFAULT_RUNTIME_MODE,
      })
      for await (const item of rpc.sessionDetailStream(sessionId)) {
        expect(item.kind).toBe('snapshot')
        if (item.kind !== 'snapshot') continue
        useChatProjectionStore
          .getState()
          .syncSessionDetailSnapshot(FIXTURE_ENVIRONMENT_ID, item.snapshot)
        break
      }
      const before = useChatProjectionStore.getState()

      cache.retain(sessionId)

      await expect.poll(() => cache.snapshot()[0]?.status).toBe('live')
      expect(useChatProjectionStore.getState()).toBe(before)
    } finally {
      cache.disposeAll()
      rpc.close()
    }
  })

  test('climbs the backoff ladder while every attempt keeps failing', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const fake = createFakeEnvironment([
      { fail: streamFailure() },
      { fail: streamFailure() },
      { fail: streamFailure() },
    ])
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })

    cache.retain(sessionId)
    await tick()
    timers.runAll()
    await tick()
    timers.runAll()
    await tick()

    expect(timers.scheduled()).toEqual([250, 500, 1_000])
    expect(fake.attempts).toHaveLength(3)
    expect(cache.snapshot()[0]?.attempt).toBe(3)

    cache.disposeAll()
  })

  test('stops retrying once the server rejects the subscription', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const fake = createFakeEnvironment([{ fail: unauthorizedFailure() }])
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })

    cache.retain(sessionId)
    await tick()

    expect(fake.attempts).toHaveLength(1)
    expect(timers.size()).toBe(0)
    expect(cache.snapshot()[0]?.status).toBe('blocked')
    expect(cache.snapshot()[0]?.error).toBe('Subscription rejected.')

    timers.runAll()
    await tick()

    expect(fake.attempts).toHaveLength(1)

    cache.disposeAll()
  })

  test('disposes a session that leaves the projection', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const fake = createFakeEnvironment()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
    })

    useChatProjectionStore
      .getState()
      .syncShellSnapshot(
        FIXTURE_ENVIRONMENT_ID,
        shellSnapshot({ sessions: [sessionShell({ id: sessionId })] }),
      )
    cache.retain(sessionId)
    await tick()

    expect(cache.size()).toBe(1)

    useChatProjectionStore.getState().syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, {
      ...shellSnapshot({ sessions: [] }),
      snapshotSequence: 2,
      updatedAt: '2026-05-28T00:00:09.000Z',
    })
    await tick()

    expect(cache.size()).toBe(0)
    expect(fake.aborts).toEqual([sessionId])

    cache.disposeAll()
  })

  test('opens no stream for sidebar sessions it was never asked to retain', async () => {
    const fake = createFakeEnvironment()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
    })
    const sessions = Array.from({ length: 12 }, (_, index) =>
      sessionShell({ id: fixtureSessionId(index + 1) }),
    )

    useChatProjectionStore
      .getState()
      .syncShellSnapshot(FIXTURE_ENVIRONMENT_ID, shellSnapshot({ sessions }))
    await tick()

    expect(fake.attempts).toEqual([])
    expect(cache.size()).toBe(0)

    cache.disposeAll()
  })

  test('publishes per-session sync status for the UI and clears it on dispose', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const fake = createFakeEnvironment([
      { fail: streamFailure() },
      { items: [{ kind: 'snapshot', snapshot: detailSnapshot(sessionId, 4) }] },
    ])
    const timers = createManualTimers()
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      scheduleTimeout: timers.schedule,
      clearScheduledTimeout: timers.clear,
    })

    cache.retain(sessionId)
    await tick()

    expect(
      selectSessionDetailSync(useSessionDetailSyncStore.getState(), {
        environmentId: FIXTURE_ENVIRONMENT_ID,
        sessionId,
      }),
    ).toEqual({
      attempt: 1,
      error: 'Stream closed.',
      status: 'reconnecting',
    })

    timers.runAll()
    await tick()

    expect(
      selectSessionDetailSync(useSessionDetailSyncStore.getState(), {
        environmentId: FIXTURE_ENVIRONMENT_ID,
        sessionId,
      }),
    ).toEqual({
      attempt: 0,
      error: null,
      status: 'live',
    })

    cache.disposeAll()
    await tick()

    expect(
      selectSessionDetailSync(useSessionDetailSyncStore.getState(), {
        environmentId: FIXTURE_ENVIRONMENT_ID,
        sessionId,
      }).status,
    ).toBe('idle')
  })

  test('treats stream traffic as access so the LRU keeps the busiest session', async () => {
    const sessionId = parseSessionId('ad686244-5b2e-59be-805f-ef86eac80feb')
    const clock = incrementingClock()
    const fake = createFakeEnvironment([
      { items: [{ kind: 'snapshot', snapshot: detailSnapshot(sessionId, 3) }] },
    ])
    const cache = createSessionDetailSubscriptionCache({
      environmentId: FIXTURE_ENVIRONMENT_ID,
      transport: fake.transport,
      now: clock,
    })

    cache.retain(sessionId)
    const retainedAt = cache.snapshot()[0]?.lastAccessedAt ?? 0
    await tick()

    expect(cache.snapshot()[0]?.lastAccessedAt).toBeGreaterThan(retainedAt)

    cache.disposeAll()
  })
})

function createFakeEnvironment(script: ScriptedAttempt[] = []) {
  const attempts: Array<{ afterSequence: number | undefined; sessionId: SessionId }> = []
  const aborts: SessionId[] = []

  const transport = unsupportedChatTransport({
    dispatchCommand: async (_command: ClientOrchestrationCommand) => ({
      result: null,
      deduped: false,
      sequence: 0,
    }),
    replayEvents: async (
      _input: OrchestrationReplayEventsInput,
    ): Promise<OrchestrationReplayEventsResult> => ({ events: [] }),
    shellStream: async function* (): AsyncGenerator<OrchestrationShellStreamItem> {
      const item = await new Promise<OrchestrationShellStreamItem>(() => undefined)

      yield item
    },
    sessionDetailStream: async function* (sessionId, input = {}) {
      const attempt = script[attempts.length] ?? {}
      attempts.push({ afterSequence: input.afterSequence, sessionId })

      for (const item of attempt.items ?? []) {
        yield item
      }
      if (attempt.fail) throw attempt.fail

      await waitForAbort(input.signal)
      aborts.push(sessionId)
    },
  })

  return { aborts, attempts, transport }
}

function waitForAbort(signal: AbortSignal | undefined) {
  return new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })
}

function createManualTimers() {
  let nextId = 1
  const scheduled: number[] = []
  const timers = new Map<number, { callback: () => void; delay: number }>()

  return {
    clear: (handle: number | ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number)
    },
    /** Delays of the timers still pending. */
    delays: () => [...timers.values()].map((timer) => timer.delay),
    runAll: () => {
      const pending = [...timers.values()]
      timers.clear()

      for (const timer of pending) {
        timer.callback()
      }
    },
    schedule: (callback: () => void, delay: number) => {
      const handle = nextId
      nextId += 1
      timers.set(handle, { callback, delay })
      scheduled.push(delay)

      return handle
    },
    /** Every delay ever scheduled, in order. */
    scheduled: () => scheduled,
    size: () => timers.size,
  }
}

function detailSnapshot(
  sessionId: SessionId,
  snapshotSequence: number,
): OrchestrationSessionDetailSnapshot {
  return {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence,
    session: {
      deletion: null,
      ...sessionShell({ id: sessionId }),
      activities: [],
      deletedAt: null,
      messages: [],
    },
  }
}

function streamFailure() {
  return createClientError({
    code: 'ORCHESTRATION_WS_CLOSED',
    message: 'Stream closed.',
    status: 502,
    why: 'The test stream dropped mid-flight.',
    fix: 'Reconnect.',
  })
}

function unauthorizedFailure() {
  return createClientError({
    code: 'ORCHESTRATION_WS_UNAUTHORIZED',
    message: 'Subscription rejected.',
    status: 401,
    why: 'The test server refused the subscription.',
    fix: 'Sign in again.',
  })
}

function incrementingClock() {
  let value = 0

  return () => {
    value += 1

    return value
  }
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function parseSessionId(value: string) {
  return v.parse(sessionIdSchema, value)
}
