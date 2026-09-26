import { afterEach, expect, test } from 'vitest'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { OrchestrationEventStore } from '../event-store'
import { pendingEvent } from './factories/projection'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

test('restart drains every persisted event page before the first snapshot', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  expect(registration.result).not.toBeNull()
  const eventStore = new OrchestrationEventStore(fixture.database)
  fixture.database.transaction(() => {
    eventStore.append(
      Array.from({ length: 1105 }, (_, index) =>
        pendingEvent('project.meta-updated', {
          projectId: registration.result?.projectId,
          title: `Title ${index}`,
          updatedAt: '2026-09-05T12:00:00.000Z',
        }),
      ),
    )
  })
  const engine = await fixture.restart()
  const first = await engine.shellSnapshot()
  expect(first.snapshotSequence).toBe(1107)
  expect(first.projects[0]?.title).toBe('Title 1104')
  expect((await engine.readModelSnapshot()).sequence).toBe(1107)
})

test('an unclaimed queued prompt is sent once after restart with claim committed first', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  const observed: string[] = []
  const runtimeStartsAtClaim: number[] = []
  const adapter = new MockProviderAdapter({
    beforeComplete: async () => {
      observed.push((await sessionFrom(fixture)).latestTurn?.providerStartState ?? 'missing')
    },
  })
  const engine = await fixture.restart(mockRuntime(adapter))
  engine.subscribeDomainEvents({
    name: 'claim-observer',
    handleEvents: (events) => {
      if (!events.some((event) => event.type === 'session.provider-start-claimed')) return
      runtimeStartsAtClaim.push(adapter.startedSessions.length)
    },
  })
  await engine.providerRuntimeIdle()
  expect(runtimeStartsAtClaim).toEqual([0])
  expect(adapter.startedTurns).toHaveLength(1)
  expect(adapter.startedTurns[0]).toMatchObject({
    sessionId: FIXTURE_SESSION_ID,
    cwd: fixture.checkout,
  })
  expect(observed).toEqual(['adopted'])
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    providerStartState: 'settled',
    state: 'completed',
  })
  const events = (await engine.replay({ afterSequence: 0 })).events
  expect(events.filter((event) => event.type === 'session.provider-start-claimed')).toHaveLength(1)
  const nextAdapter = new MockProviderAdapter()
  await fixture.restart(mockRuntime(nextAdapter))
  await fixture.engine.providerRuntimeIdle()
  expect(nextAdapter.startedTurns).toHaveLength(0)
})

test.each(['claimed', 'adopted'] as const)(
  'restart interrupts a %s prompt without resending and rejects stale recovery',
  async (state) => {
    const fixture = await createOrchestrationFixture()
    fixtures.push(fixture)
    const registration = await fixture.register()
    if (!registration.result) throw new TypeError('Missing registration')
    await fixture.createSession(registration.result.worktreeId)
    await fixture.startTurn()
    const queued = (await sessionFrom(fixture)).latestTurn
    if (!queued) throw new TypeError('Missing turn')
    const claim = await fixture.command({
      type: 'session.provider-start.claim',
      commandId: 'claim-before-crash',
      sessionId: FIXTURE_SESSION_ID,
      turnId: queued.turnId,
      observedSequence: queued.providerStartSequence,
      generation: 1,
      runtimeEpoch: 'epoch-crashed',
      createdAt: '2026-09-05T12:00:00.000Z',
    })
    if (state === 'adopted')
      await fixture.command({
        type: 'session.provider-start.adopt',
        commandId: 'adopt-before-crash',
        sessionId: FIXTURE_SESSION_ID,
        turnId: queued.turnId,
        observedSequence: claim.sequence,
        generation: 1,
        runtimeEpoch: 'epoch-crashed',
        createdAt: '2026-09-05T12:00:01.000Z',
      })
    const stale = (await sessionFrom(fixture)).latestTurn
    if (!stale) throw new TypeError('Missing turn')
    const sessionId = (await sessionFrom(fixture)).id
    expect(await fixture.engine.beginRestart(new Set([sessionId]))).toMatchObject({
      restarting: true,
      interrupted: [
        { sessionId: FIXTURE_SESSION_ID, state: state === 'claimed' ? 'starting' : 'running' },
      ],
    })
    const adapter = new MockProviderAdapter()
    const engine = await fixture.restart(mockRuntime(adapter))
    const shell = await engine.shellSnapshot()
    expect(shell.sessions[0]).toMatchObject({
      attentionState: 'needs-input',
      latestTurn: {
        endReason: 'server-restart',
        providerStartState: 'interrupted',
        state: 'interrupted',
      },
    })
    await engine.providerRuntimeIdle()
    expect(adapter.startedTurns).toHaveLength(0)
    await expect(
      fixture.command({
        type: 'session.runtime.recover',
        commandId: 'stale-recovery',
        sessionId: FIXTURE_SESSION_ID,
        turnId: stale.turnId,
        observedSequence: stale.providerStartSequence,
        runtimeEpoch: 'epoch-crashed',
        createdAt: '2026-09-05T12:00:02.000Z',
        message: 'old',
      }),
    ).rejects.toMatchObject({ code: 'orchestration.START_STATE_CONFLICT' })
    await fixture.startTurn(FIXTURE_SESSION_ID, 'turn-after-recovery')
    await engine.providerRuntimeIdle()
    expect(adapter.startedTurns).toHaveLength(1)
  },
)

test('a second prompt cannot overwrite an unclaimed durable start', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  await expect(fixture.startTurn(FIXTURE_SESSION_ID, 'turn-overwrite')).rejects.toMatchObject({
    code: 'orchestration.START_STATE_CONFLICT',
  })
  expect((await sessionFrom(fixture)).latestTurn?.turnId).toBe('turn-1')
})
