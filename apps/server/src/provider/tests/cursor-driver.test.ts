import { afterEach, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  providerInstanceIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import { createAcpFixture } from '../../../test/factories/acp'
import { cursorDriver } from '../drivers/cursor'
import type { ProviderRuntimeEvent } from '../types'

const fixtures: Awaited<ReturnType<typeof createAcpFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
})

it('starts an enabled Cursor instance, streams an answer, settles an error and resumes its native session', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  const started = await adapter.startRuntime(fixture.input)
  await adapter.sendTurn(fixture.input)
  await expect.poll(() => events.some((event) => event.type === 'turn.completed')).toBe(true)
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'assistant.delta',
      delta: expect.stringContaining('fixture:hello:'),
    }),
  )
  const cursor = started.providerResumeCursor
  await adapter.stopRuntime({ sessionId: fixture.input.sessionId })
  events.length = 0
  const resumed = await adapter.startRuntime({
    ...fixture.input,
    providerResumeCursor: cursor,
    runtimeEpoch: 'resumed-epoch',
  })
  expect(resumed.providerConversationMarker).toBe(started.providerConversationMarker)
  expect(events.some((event) => event.type === 'assistant.delta')).toBe(false)
  await adapter.sendTurn({
    ...fixture.input,
    runtimeEpoch: 'resumed-epoch',
    providerResumeCursor: cursor,
    messageText: 'fail',
  })
  await expect
    .poll(() => events.find((event) => event.type === 'turn.completed')?.payload)
    .toMatchObject({ state: 'failed' })
  expect((await fixture.records()).filter((entry) => entry.method === 'session/load')).toHaveLength(
    1,
  )
  expect(await adapter.snapshot()).toMatchObject({
    installed: true,
    message: 'Live account smoke test pending.',
    traits: { supportsSteering: true },
  })
})

it('bridges Cursor permissions, user questions and proposed plans through native RPC replies', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  await adapter.sendTurn({ ...fixture.input, messageText: 'permission' })
  await expect.poll(() => events.find((event) => event.type === 'request.opened')).toBeDefined()
  const permission = events.find((event) => event.type === 'request.opened')!
  await adapter.respondApproval({
    sessionId: fixture.input.sessionId,
    requestId: v.parse(approvalRequestIdSchema, permission.requestId),
    decision: 'accept',
  })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(1)
  await adapter.sendTurn({
    ...fixture.input,
    messageText: 'question',
    turnId: v.parse(turnIdSchema, 'question-turn'),
  })
  await expect
    .poll(() => events.find((event) => event.type === 'user-input.requested'))
    .toBeDefined()
  const question = events.find((event) => event.type === 'user-input.requested')!
  await adapter.respondUserInput({
    sessionId: fixture.input.sessionId,
    requestId: v.parse(approvalRequestIdSchema, question.requestId),
    answers: { choice: 'one' },
  })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(2)
  await adapter.sendTurn({
    ...fixture.input,
    messageText: 'plan',
    turnId: v.parse(turnIdSchema, 'plan-turn'),
  })
  await expect
    .poll(() => events.find((event) => event.type === 'proposed-plan.upsert'))
    .toMatchObject({ planMarkdown: '# Fixture plan' })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(3)
  const records = await fixture.records()
  expect(records.find((entry) => entry.id === 'permission-1' && entry.result)?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'yes' },
  })
  expect(records.find((entry) => entry.id === 'question-1' && entry.result)?.result).toEqual({
    answers: { choice: 'one' },
  })
})

it('steers the same active Cursor turn and emits one final completion', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  await adapter.sendTurn({ ...fixture.input, messageText: 'hold' })
  await adapter.steerTurn!({ ...fixture.input, messageText: 'steered' })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(1)
  expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1)
  expect(events.filter((event) => event.type === 'assistant.complete')).toHaveLength(1)
  expect(events.find((event) => event.type === 'assistant.delta')).toMatchObject({
    turnId: fixture.input.turnId,
    delta: expect.stringContaining('steered'),
  })
})

it('isolates two Cursor profiles, refuses foreign resume cursors and stops only its own process', async () => {
  const first = await createAcpFixture(cursorDriver)
  const second = await createAcpFixture(cursorDriver)
  fixtures.push(first, second)
  const left = first.handle.adapter
  const right = second.handle.adapter
  const started = await left.startRuntime(first.input)
  await right.startRuntime(second.input)
  await left.sendTurn({ ...first.input, messageText: 'hold' })
  await left.stopRuntime({ sessionId: first.input.sessionId })
  expect(await left.hasRuntime(first.input)).toBe(false)
  expect(await right.hasRuntime(second.input)).toBe(true)
  await right.sendTurn(second.input)
  await expect
    .poll(async () => (await second.records()).some((entry) => entry.method === 'session/prompt'))
    .toBe(true)
  expect((await first.records()).find((entry) => entry.event === 'spawn')?.profile).not.toBe(
    (await second.records()).find((entry) => entry.event === 'spawn')?.profile,
  )
  const foreign = {
    ...(started.providerResumeCursor as object),
    providerInstanceId: v.parse(providerInstanceIdSchema, 'another-account'),
  }
  await expect(
    left.startRuntime({ ...first.input, providerResumeCursor: foreign }),
  ).rejects.toMatchObject({ code: 'provider.SESSION_PROVIDER_CONFLICT' })
  await expect(
    left.prepareRollbackSession({ sessionId: first.input.sessionId, numTurns: 1 }),
  ).rejects.toMatchObject({ code: 'provider.ROLLBACK_UNSUPPORTED' })
  expect(left.capabilities).toMatchObject({
    conversationRollback: false,
    signIn: false,
    listCommands: false,
  })
})

it('refuses steering after its original runtime is stopped during preparation', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  await adapter.sendTurn({ ...fixture.input, messageText: 'hold' })
  await expect
    .poll(async () => (await fixture.records()).some((entry) => entry.method === 'session/prompt'))
    .toBe(true)
  const steering = adapter.steerTurn!({ ...fixture.input, messageText: 'late-steer' })
  const stopping = adapter.stopRuntime(fixture.input)
  await expect(steering).rejects.toMatchObject({ code: 'provider.STEERING_UNAVAILABLE' })
  await stopping
  expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
  expect(
    (await fixture.records()).filter((entry) => entry.method === 'session/prompt'),
  ).toHaveLength(1)
})

it('drains one native cancellation and then answers a later turn in the same session', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  await adapter.sendTurn({ ...fixture.input, messageText: 'hold' })
  await expect
    .poll(async () => (await fixture.records()).some((entry) => entry.method === 'session/prompt'))
    .toBe(true)
  await adapter.interruptTurn(fixture.input)
  expect(events.find((event) => event.type === 'turn.completed')?.payload).toMatchObject({
    state: 'interrupted',
  })
  await adapter.sendTurn({
    ...fixture.input,
    turnId: v.parse(turnIdSchema, 'after-cancel'),
    messageText: 'after-cancel',
  })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(2)
  expect(
    (await fixture.records()).filter((entry) => entry.method === 'session/cancel'),
  ).toHaveLength(1)
})

it('retires a terminated native peer and resumes the saved native identity for a later turn', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const adapter = fixture.handle.adapter
  const events: ProviderRuntimeEvent[] = []
  adapter.subscribeEvents((event) => events.push(event))
  const started = await adapter.startRuntime(fixture.input)
  await adapter.sendTurn({ ...fixture.input, messageText: 'exit-native' })
  await expect
    .poll(() => events.find((event) => event.type === 'turn.completed')?.payload)
    .toMatchObject({ state: 'failed' })
  expect(await adapter.hasRuntime(fixture.input)).toBe(false)
  expect(events.find((event) => event.type === 'runtime.exited')?.payload).toMatchObject({
    recoverable: true,
  })
  const firstPid = (await fixture.records()).find((entry) => entry.event === 'spawn')!.pid as number
  await expect
    .poll(() => {
      try {
        process.kill(firstPid, 0)
        return true
      } catch {
        return false
      }
    })
    .toBe(false)
  await adapter.sendTurn({
    ...fixture.input,
    providerResumeCursor: started.providerResumeCursor,
    turnId: v.parse(turnIdSchema, 'after-retirement'),
    messageText: 'after-retirement',
  })
  await expect.poll(() => events.filter((event) => event.type === 'turn.completed').length).toBe(2)
  expect(
    events
      .filter((event) => event.type === 'assistant.delta')
      .some((event) => event.delta === 'REPLAY'),
  ).toBe(false)
  const records = await fixture.records()
  expect(records.filter((entry) => entry.event === 'spawn')).toHaveLength(2)
  expect(records.find((entry) => entry.method === 'session/load')?.params.sessionId).toBe(
    started.providerConversationMarker,
  )
})

it('maps the native Cursor todo extension including its camel-case running status', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const events: ProviderRuntimeEvent[] = []
  fixture.handle.adapter.subscribeEvents((event) => events.push(event))
  await fixture.handle.adapter.sendTurn({ ...fixture.input, messageText: 'todos' })
  await expect
    .poll(() => events.find((event) => event.type === 'turn.plan.updated')?.payload)
    .toMatchObject({ plan: [{ step: 'Fixture step', status: 'inProgress' }] })
})
