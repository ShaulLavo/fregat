import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
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

test('settling completed work releases its native runtime and a later send starts normally', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  expect(
    await adapter.hasRuntime({ sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID) }),
  ).toBe(true)
  await fixture.command({
    type: 'session.settle',
    sessionId: FIXTURE_SESSION_ID,
    commandId: 'settle-release',
  })
  await fixture.engine.providerRuntimeIdle()
  expect(
    await adapter.hasRuntime({ sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID) }),
  ).toBe(false)
  expect((await sessionFrom(fixture)).settledOverride).toBe('settled')
  await fixture.startTurn(FIXTURE_SESSION_ID, 'after-settle')
  await fixture.engine.providerRuntimeIdle()
  expect(
    await adapter.hasRuntime({ sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID) }),
  ).toBe(true)
  expect((await sessionFrom(fixture)).settledOverride).toBeNull()
  expect(
    (await sessionFrom(fixture)).messages.some((message) => message.id === 'message-after-settle'),
  ).toBe(true)
})

test('a queued conditional release skips a session reactivated before native execution', async () => {
  const adapter = new MockProviderAdapter()
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  const worktreeId = registration.result!.worktreeId
  const barrierId = 'a0000000-0000-4000-8000-000000000099'
  await fixture.createSession(worktreeId)
  await fixture.createSession(worktreeId, barrierId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  await fixture.startTurn(barrierId, 'barrier-turn')
  await fixture.engine.providerRuntimeIdle()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const stop = adapter.stopRuntime.bind(adapter)
  const stopped: string[] = []
  adapter.stopRuntime = async (input) => {
    stopped.push(input.sessionId)
    if (input.sessionId === barrierId) {
      entered.resolve()
      await release.promise
    }
    await stop(input)
  }
  try {
    await fixture.command({
      type: 'session.runtime.stop',
      sessionId: barrierId,
      commandId: 'block-reactor',
    })
    await entered.promise
    await fixture.command({
      type: 'session.settle',
      sessionId: FIXTURE_SESSION_ID,
      commandId: 'queued-settlement',
    })
    await fixture.command({
      type: 'session.runtime.stop',
      sessionId: FIXTURE_SESSION_ID,
      commandId: 'queued-release',
      onlyIfSettled: true,
    })
    await fixture.startTurn(FIXTURE_SESSION_ID, 'reactivated-before-release')
    release.resolve()
    await fixture.engine.providerRuntimeIdle()
    expect(stopped).not.toContain(FIXTURE_SESSION_ID)
    expect(
      await adapter.hasRuntime({ sessionId: v.parse(sessionIdSchema, FIXTURE_SESSION_ID) }),
    ).toBe(true)
    const session = await sessionFrom(fixture)
    expect(session.settledOverride).toBeNull()
    expect(session.latestTurn).toMatchObject({
      turnId: 'reactivated-before-release',
      state: 'completed',
    })
  } finally {
    release.resolve()
  }
})
