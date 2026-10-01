import { ProviderRuntimeEventStream } from '../../../server/src/provider/provider-runtime-event-stream'
import { test, expect } from '../fixtures'
import {
  makeSessionDomainFixture,
  DOMAIN_SESSION,
  AMBIGUOUS_SESSION,
} from '../factories/session-domain'

test('native roster liveness reaches real shell routes and stays inside its runtime identity', async () => {
  const fixture = await makeSessionDomainFixture()
  const stream = new ProviderRuntimeEventStream()
  const subscribe = fixture.adapter.subscribeEvents.bind(fixture.adapter)
  fixture.adapter.subscribeEvents = (listener) => {
    const original = subscribe(listener)
    const off = stream.subscribe(listener)
    return () => {
      original()
      off()
    }
  }
  try {
    await fixture.server.restart({ providerRuntime: true })
    const registration = await fixture.register()
    expect(registration.result).toBeDefined()
    const worktreeId = registration.result!.worktreeId
    await fixture.createSession(worktreeId)
    await fixture.createSession(worktreeId, AMBIGUOUS_SESSION)
    await fixture.startTurn()
    await fixture.startTurn(AMBIGUOUS_SESSION)
    await fixture.engine.providerRuntimeIdle()
    const session = await fixture.session()
    expect(session.runtime?.status).toBe('ready')
    expect(session.latestTurn?.state).toBe('completed')
    const common = {
      eventId: 'native-roster',
      createdAt: new Date().toISOString(),
      sessionId: DOMAIN_SESSION,
      runtimeEpoch: session.runtime!.runtimeEpoch,
    }
    const live = fixture.engine.shellStream({ signal: AbortSignal.timeout(3_000) })
    expect((await live.next()).value?.kind).toBe('snapshot')
    expect((await live.next()).value?.kind).toBe('synchronized')
    const watch = { taskId: 'watch', taskType: 'monitor', description: 'Watch logs' }
    const agent = { taskId: 'agent', taskType: 'local_agent', description: 'Work' }
    for (const [tasks, expected] of [
      [[watch, agent], 'working'],
      [[watch], 'monitoring'],
      [[], null],
    ] satisfies [(typeof watch)[], string | null][]) {
      stream.publish({
        ...common,
        eventId: `native-roster-${expected ?? 'ready'}`,
        type: 'tasks.roster',
        payload: { tasks },
      })
      await fixture.engine.providerRuntimeIdle()
      expect((await live.next()).value).toMatchObject({
        kind: 'session-upserted',
        session: { id: DOMAIN_SESSION, backgroundLiveness: expected },
      })
      const shell = await fixture.snapshot()
      expect(
        shell.sessions.find((row) => row.id === DOMAIN_SESSION)?.backgroundLiveness ?? null,
      ).toBe(expected)
      expect(
        shell.sessions.find((row) => row.id === AMBIGUOUS_SESSION)?.backgroundLiveness ?? null,
      ).toBeNull()
      if (expected !== 'working') continue
      stream.publish({
        ...common,
        eventId: 'same-membership-reordered',
        type: 'tasks.roster',
        payload: { tasks: [agent, { ...watch, description: 'Updated description' }] },
      })
      await fixture.engine.providerRuntimeIdle()
      expect(
        (await fixture.session()).activities.filter((row) => row.kind === 'tasks.roster'),
      ).toHaveLength(1)
    }
    await live.return(undefined)
    stream.publish({ ...common, eventId: 'late-start', type: 'task.started', payload: watch })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness ?? null,
    ).toBeNull()
    stream.publish({
      ...common,
      eventId: 'monitor-again',
      type: 'tasks.roster',
      payload: { tasks: [watch] },
    })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness,
    ).toBe('monitoring')
    await fixture.dispatch({
      type: 'session.runtime.stop',
      commandId: 'stop-monitor',
      sessionId: DOMAIN_SESSION,
    })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness ?? null,
    ).toBeNull()
    await fixture.startTurn()
    await fixture.engine.providerRuntimeIdle()
    const newEpoch = (await fixture.session()).runtime!.runtimeEpoch
    expect(newEpoch).not.toBe(common.runtimeEpoch)
    stream.publish({
      ...common,
      eventId: 'stale-runtime-roster',
      type: 'tasks.roster',
      payload: { tasks: [watch] },
    })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness ?? null,
    ).toBeNull()
    const child = {
      ...common,
      runtimeEpoch: newEpoch,
      agent: { threadId: 'child', parentThreadId: 'parent', status: 'running' as const },
    }
    stream.publish({
      ...child,
      eventId: 'child-start',
      type: 'task.started',
      payload: { taskId: 'child' },
    })
    stream.publish({
      ...child,
      eventId: 'child-shell-start',
      type: 'task.started',
      payload: { taskId: 'child-shell', taskType: 'shell' },
    })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness,
    ).toBe('working')
    stream.publish({
      ...child,
      eventId: 'child-idle',
      type: 'task.progress',
      agent: { ...child.agent, status: 'idle' },
      payload: { taskId: 'child' },
    })
    stream.publish({
      ...child,
      eventId: 'late-child-shell',
      type: 'task.progress',
      payload: { taskId: 'child-shell', taskType: 'shell', status: 'running' },
    })
    await fixture.engine.providerRuntimeIdle()
    expect(
      (await fixture.snapshot()).sessions.find((row) => row.id === DOMAIN_SESSION)
        ?.backgroundLiveness ?? null,
    ).toBeNull()
  } finally {
    await fixture.server.cleanup()
  }
})
