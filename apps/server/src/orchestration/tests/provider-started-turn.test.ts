import { PROVIDER_TURN_STARTED_ACTIVITY_KIND, sessionIdSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import * as v from 'valibot'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { MockProviderAdapter } from '../../provider/adapters/mock'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function sessionWithFinishedTurn(adapter: MockProviderAdapter) {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing worktree registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  return fixture
}

test('a turn the harness starts becomes the running turn, keeps its reply and settles', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await sessionWithFinishedTurn(adapter)
  const wakeup = adapter.startProviderTurn({
    origin: 'scheduled',
    sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID),
  })
  await fixture.engine.providerRuntimeIdle()

  const running = await sessionFrom(fixture)
  expect(running.latestTurn).toMatchObject({
    providerStartState: 'adopted',
    state: 'running',
    turnId: wakeup.turnId,
  })
  expect(running.runtime).toMatchObject({ activeTurnId: wakeup.turnId, status: 'running' })
  expect(running.activities).toContainEqual(
    expect.objectContaining({
      kind: PROVIDER_TURN_STARTED_ACTIVITY_KIND,
      summary: 'Scheduled wake-up',
      turnId: wakeup.turnId,
    }),
  )
  // The owner's next prompt waits for the harness turn instead of racing it.
  await expect(fixture.startTurn(FIXTURE_SESSION_ID, 'turn-2')).rejects.toMatchObject({
    code: 'orchestration.START_STATE_CONFLICT',
  })

  wakeup.finish('AWAKE')
  await fixture.engine.providerRuntimeIdle()
  const settled = await sessionFrom(fixture)
  expect(settled.latestTurn).toMatchObject({
    providerStartState: 'settled',
    state: 'completed',
    turnId: wakeup.turnId,
  })
  expect(settled.messages).toContainEqual(
    expect.objectContaining({ role: 'assistant', text: 'AWAKE', turnId: wakeup.turnId }),
  )

  await fixture.startTurn(FIXTURE_SESSION_ID, 'turn-2')
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'completed',
    turnId: 'turn-2',
  })
})

test('a harness turn that starts while a requested turn runs stays out of the log', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await sessionWithFinishedTurn(adapter)
  const sessionId = v.parse(sessionIdSchema, FIXTURE_SESSION_ID)
  const first = adapter.startProviderTurn({ origin: 'task', sessionId })
  await fixture.engine.providerRuntimeIdle()
  const second = adapter.startProviderTurn({ origin: 'scheduled', sessionId })
  await fixture.engine.providerRuntimeIdle()

  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'running',
    turnId: first.turnId,
  })
  expect(second.turnId).not.toBe(first.turnId)
  first.finish('done')
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'completed',
    turnId: first.turnId,
  })
})
