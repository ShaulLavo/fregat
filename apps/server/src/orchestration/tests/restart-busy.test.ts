import { orchestrationCommandSchema, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { restartFixture } from '../../../test/factories/server-update'
import { closeTestApps } from '../../../test/server'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import type { ProviderRuntimeEvent, ProviderRuntimeStartInput } from '../../provider/types'

const at = '2026-09-25T12:00:00.000Z'
const SESSION = v.parse(sessionIdSchema, FIXTURE_SESSION_ID)
const OTHER = v.parse(sessionIdSchema, '00000000-0000-4000-8000-00000000000c')
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  await closeTestApps()
})

type EngineFixture = Awaited<ReturnType<typeof createOrchestrationFixture>>

async function engineWithSession() {
  const fixture = await createOrchestrationFixture()
  cleanups.push(() => fixture.close())
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing worktree registration')
  await fixture.createSession(registration.result.worktreeId)
  return fixture
}

function setRuntime(fixture: EngineFixture, status: 'starting' | 'running' | 'waiting') {
  return fixture.command({
    type: 'session.runtime.set',
    commandId: `runtime-${status}`,
    sessionId: SESSION,
    createdAt: at,
    runtime: {
      sessionId: SESSION,
      providerInstanceId: 'codex',
      providerName: 'Codex',
      providerDriverKind: 'codex',
      providerBindingHandle: null,
      providerResumeCursor: null,
      providerConversationMarker: null,
      runtimeEpoch: 'epoch',
      status,
      runtimeMode: 'full-access',
      activeTurnId: null,
      lastError: null,
      updatedAt: at,
    },
  })
}

async function providerStart(fixture: EngineFixture, type: 'claim' | 'adopt') {
  const turn = (await sessionFrom(fixture)).latestTurn
  if (!turn) throw new TypeError('Missing queued turn')
  return fixture.command({
    type: `session.provider-start.${type}`,
    commandId: `provider-start-${type}`,
    sessionId: SESSION,
    turnId: turn.turnId,
    observedSequence: turn.providerStartSequence,
    generation: turn.providerStartGeneration + (type === 'claim' ? 1 : 0),
    runtimeEpoch: 'epoch',
    createdAt: at,
  })
}

const engineStates = {
  'runtime starting': {
    state: 'starting',
    arrange: (fixture: EngineFixture) => setRuntime(fixture, 'starting'),
  },
  'runtime running': {
    state: 'running',
    arrange: (fixture: EngineFixture) => setRuntime(fixture, 'running'),
  },
  'runtime waiting': {
    state: 'waiting',
    arrange: (fixture: EngineFixture) => setRuntime(fixture, 'waiting'),
  },
  'a claimed turn': {
    state: 'starting',
    async arrange(fixture: EngineFixture) {
      await fixture.startTurn()
      await providerStart(fixture, 'claim')
    },
  },
  'an adopted turn': {
    state: 'running',
    async arrange(fixture: EngineFixture) {
      await fixture.startTurn()
      await providerStart(fixture, 'claim')
      await providerStart(fixture, 'adopt')
    },
  },
  'a pending rewind': {
    state: 'rewinding',
    arrange: (fixture: EngineFixture) =>
      fixture.command({
        type: 'session.checkpoint.revert',
        commandId: 'pending-rewind',
        sessionId: SESSION,
        turnCount: 0,
        restoreFiles: false,
      }),
  },
} as const

describe('the restart confirmation names every busy session', () => {
  test.each(Object.entries(engineStates))('%s', async (_, { state, arrange }) => {
    const fixture = await engineWithSession()
    await arrange(fixture)

    expect(await fixture.engine.beginRestart(new Set())).toEqual({
      restarting: false,
      busy: [{ sessionId: SESSION, title: 'Fixture session', projectTitle: 'Fixture', state }],
    })
  })

  test('a queued turn nobody claimed is not busy', async () => {
    const fixture = await engineWithSession()
    await fixture.startTurn()

    expect(await fixture.engine.beginRestart(new Set())).toEqual({
      restarting: true,
      interrupted: [],
    })
  })

  test('a provider launch still in flight is starting, even once its turn was recovered', async () => {
    const launch = Promise.withResolvers<void>()
    cleanups.push(launch.resolve)
    const adapter = new HeldLaunchAdapter(launch.promise)
    const fixture = await restartFixture(adapter)
    await fixture.createSession(await fixture.register(), OTHER, 'Launching session')
    await fixture.send(OTHER, 'launching-turn')
    await adapter.entered.promise
    const starting = {
      restarting: false,
      busy: [
        {
          sessionId: OTHER,
          title: 'Launching session',
          projectTitle: 'Platform',
          state: 'starting',
        },
      ],
    }
    expect((await fixture.restart([])).result).toEqual(starting)

    const turn = await fixture.latestTurn(OTHER)
    if (!turn) throw new TypeError('Missing claimed turn')
    await fixture.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.runtime.recover',
        commandId: 'recover-before-launch',
        sessionId: OTHER,
        turnId: turn.turnId,
        observedSequence: turn.providerStartSequence,
        runtimeEpoch: turn.runtimeEpoch,
        message: 'Recovered while launching',
        createdAt: at,
      }),
    )
    expect(await fixture.latestTurn(OTHER)).toMatchObject({
      providerStartState: 'interrupted',
      endReason: 'server-restart',
    })

    expect((await fixture.restart([])).result).toEqual(starting)
  })

  test('background work after a finished turn is background', async () => {
    const adapter = new EmittingAdapter()
    const fixture = await restartFixture(adapter)
    await fixture.createSession(await fixture.register(), OTHER, 'Monitoring session')
    await fixture.send(OTHER, 'finished-turn')
    await fixture.engine.providerRuntimeIdle()
    const runtimeEpoch = (await fixture.latestTurn(OTHER))?.runtimeEpoch
    if (!runtimeEpoch) throw new TypeError('Missing runtime epoch')
    adapter.emit({
      type: 'task.started',
      eventId: 'background-task',
      sessionId: OTHER,
      runtimeEpoch,
      createdAt: at,
      payload: { taskId: 'watcher', taskType: 'local_bash' },
    })
    await fixture.engine.providerRuntimeIdle()

    expect((await fixture.restart([])).result).toEqual({
      restarting: false,
      busy: [
        {
          sessionId: OTHER,
          title: 'Monitoring session',
          projectTitle: 'Platform',
          state: 'background',
        },
      ],
    })
  })
})

describe('a sleeping session', () => {
  test('is listed with its state, and a shell read says when it wakes', async () => {
    const adapter = new MockProviderAdapter({ wakeupMinutes: 30 })
    const fixture = await restartFixture(adapter)
    await fixture.createSession(await fixture.register(), OTHER, 'Sleeping session')
    await fixture.send(OTHER, 'schedule-a-wakeup')
    await fixture.engine.providerRuntimeIdle()

    expect((await fixture.restart([])).result).toEqual({
      restarting: false,
      busy: [
        {
          sessionId: OTHER,
          title: 'Sleeping session',
          projectTitle: 'Platform',
          state: 'sleeping',
        },
      ],
    })
    const shell = await fixture.engine.shellSnapshot()
    const sleepingUntil = shell.sessions.find((session) => session.id === OTHER)?.sleepingUntil
    expect(Date.parse(sleepingUntil ?? '')).toBeGreaterThan(Date.now())
  })
})

class HeldLaunchAdapter extends MockProviderAdapter {
  readonly entered = Promise.withResolvers<void>()
  private readonly held: Promise<void>

  constructor(held: Promise<void>) {
    super()
    this.held = held
  }

  override async startRuntime(input: ProviderRuntimeStartInput) {
    this.entered.resolve()
    await this.held
    return super.startRuntime(input)
  }
}

// Replays a provider event the mock never emits on its own.
class EmittingAdapter extends MockProviderAdapter {
  private readonly subscribers = new Set<(event: ProviderRuntimeEvent) => void>()

  override subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    const unsubscribe = super.subscribeEvents(subscriber)
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
      unsubscribe()
    }
  }

  emit(event: ProviderRuntimeEvent) {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}
