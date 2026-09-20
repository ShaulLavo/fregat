import { expect, onTestFinished, test } from 'vitest'
import * as v from 'valibot'
import { modelSelectionSchema } from '@workspace/contracts'
import {
  createOrchestrationFixture,
  FIXTURE_MODEL,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { selectTitleModel } from '../title-generation'

test('manual rename wins over initial generation and survives restart', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.meta.update',
    commandId: 'manual',
    sessionId: FIXTURE_SESSION_ID,
    title: 'My title',
  })
  await fixture.command({
    type: 'session.title.generate.complete',
    commandId: 'late',
    sessionId: FIXTURE_SESSION_ID,
    expectedTitle: 'Fixture session',
    expectedVersion: null,
    title: 'Generated title',
    needsRefinement: true,
  })
  expect((await sessionFrom(fixture)).title).toBe('My title')
  await fixture.restart()
  expect((await sessionFrom(fixture)).titleState).toEqual({
    source: 'manual',
    version: 'manual',
    needsRefinement: false,
  })
})

test('stale regeneration cannot clear or overwrite a newer request or manual rename', async () => {
  const fixture = await createOrchestrationFixture()
  onTestFinished(() => fixture.close())
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  for (const commandId of ['first', 'second'])
    await fixture.command({
      type: 'session.meta.update',
      commandId,
      sessionId: FIXTURE_SESSION_ID,
      regenerateTitle: true,
    })
  await fixture.command({
    type: 'session.title.regeneration.complete',
    commandId: 'old-result',
    sessionId: FIXTURE_SESSION_ID,
    requestId: 'first',
    title: 'Stale title',
  })
  expect((await sessionFrom(fixture)).titleRegeneration?.requestId).toBe('second')
  await fixture.command({
    type: 'session.meta.update',
    commandId: 'manual',
    sessionId: FIXTURE_SESSION_ID,
    title: 'Keep this',
  })
  await fixture.command({
    type: 'session.title.regeneration.complete',
    commandId: 'new-result',
    sessionId: FIXTURE_SESSION_ID,
    requestId: 'second',
    title: 'Also stale',
  })
  expect((await sessionFrom(fixture)).title).toBe('Keep this')
  expect((await sessionFrom(fixture)).titleRegeneration).toBeNull()
})

test('real provider generation uses the configured model and settles pending state', async () => {
  const adapter = new MockProviderAdapter({
    responseText: '{"title":"Investigate worker failures","needsRefinement":false}',
  })
  const runtime = mockRuntime(adapter)
  const fixture = await createOrchestrationFixture({
    engineOptions: {
      providerRuntime: runtime,
      titleModel: async () =>
        v.parse(modelSelectionSchema, { ...FIXTURE_MODEL, model: 'title-model' }),
    },
  })
  onTestFinished(async () => {
    await fixture.close()
    await runtime.adapterRegistry.dispose()
  })
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  await fixture.command({
    type: 'session.meta.update',
    commandId: 'regenerate',
    sessionId: FIXTURE_SESSION_ID,
    regenerateTitle: true,
  })
  await fixture.engine.providerRuntimeIdle()
  const session = await sessionFrom(fixture)
  expect(session.title).toBe('Investigate worker failures')
  expect(session.titleRegeneration).toBeNull()
  expect(session.titleGenerationError).toBeNull()
  const titleTurn = adapter.startedTurns.find((turn) => turn.modelSelection.model === 'title-model')
  expect(titleTurn?.ephemeral).toBe(true)
  expect(titleTurn?.messageText).toContain('USER:')
  expect(adapter.startedSessions.some((session) => session.ephemeral)).toBe(true)
})

test('first prompt generates and refines a provisional title once the parent completes', async () => {
  const adapter = new MockProviderAdapter({
    responseText: '{"title":"Investigate worker failures","needsRefinement":true}',
  })
  const runtime = mockRuntime(adapter)
  const fixture = await createOrchestrationFixture({
    engineOptions: {
      providerRuntime: runtime,
      titleModel: async () =>
        v.parse(modelSelectionSchema, { ...FIXTURE_MODEL, model: 'title-model' }),
    },
  })
  onTestFinished(async () => {
    await fixture.close()
    await runtime.adapterRegistry.dispose()
  })
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.turn.start',
    commandId: 'start',
    sessionId: FIXTURE_SESSION_ID,
    turnId: 'first-turn',
    titleSeed: 'Fixture session',
    message: {
      messageId: 'first-message',
      role: 'user',
      text: 'Diagnose worker crashes',
      attachments: [],
    },
  })
  await fixture.engine.providerRuntimeIdle()
  const session = await sessionFrom(fixture)
  expect(session.title).toBe('Investigate worker failures')
  expect(session.titleState).toMatchObject({ source: 'generated', needsRefinement: false })
  expect(session.titleRegeneration).toBeNull()
  expect(
    adapter.startedTurns.filter((turn) => turn.modelSelection.model === 'title-model'),
  ).toHaveLength(2)
})

test('restart clears interrupted generation and empty context settles without a provider call', async () => {
  const adapter = new MockProviderAdapter()
  const runtime = mockRuntime(adapter)
  const fixture = await createOrchestrationFixture({
    engineOptions: {
      titleModel: async () => v.parse(modelSelectionSchema, FIXTURE_MODEL),
    },
  })
  onTestFinished(async () => {
    await fixture.close()
    await runtime.adapterRegistry.dispose()
  })
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.command({
    type: 'session.meta.update',
    commandId: 'before-restart',
    sessionId: FIXTURE_SESSION_ID,
    regenerateTitle: true,
  })
  await fixture.restart(runtime)
  await fixture.engine.ready
  expect((await sessionFrom(fixture)).titleRegeneration).toBeNull()
  expect((await sessionFrom(fixture)).titleGenerationError).toContain('interrupted')
  await fixture.command({
    type: 'session.meta.update',
    commandId: 'after-restart',
    sessionId: FIXTURE_SESSION_ID,
    regenerateTitle: true,
  })
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).titleGenerationError).toBeNull()
  expect((await sessionFrom(fixture)).titleRegeneration).toBeNull()
  expect(adapter.startedTurns).toHaveLength(0)
})

test('generation failure clears pending and remains retryable', async () => {
  const adapter = new MockProviderAdapter({ shouldFail: true })
  const runtime = mockRuntime(adapter)
  const fixture = await createOrchestrationFixture({
    engineOptions: {
      providerRuntime: runtime,
      titleModel: async () => v.parse(modelSelectionSchema, FIXTURE_MODEL),
    },
  })
  onTestFinished(async () => {
    await fixture.close()
    await runtime.adapterRegistry.dispose()
  })
  const registration = await fixture.register()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  for (const commandId of ['attempt-one', 'attempt-two']) {
    await fixture.command({
      type: 'session.meta.update',
      commandId,
      sessionId: FIXTURE_SESSION_ID,
      regenerateTitle: true,
    })
    await fixture.engine.providerRuntimeIdle()
    const session = await sessionFrom(fixture)
    expect(session.titleRegeneration).toBeNull()
    expect(session.titleGenerationError).toBeTruthy()
    expect(session.title).toBe('Fixture session')
  }
  expect(adapter.startedTurns).toHaveLength(3)
})

test('title model keeps enabled configuration and falls back by driver only when disabled', async () => {
  const configured = v.parse(modelSelectionSchema, { ...FIXTURE_MODEL, model: 'explicit-model' })
  const codex = await new MockProviderAdapter().snapshot()
  const claude = {
    ...codex,
    providerInstanceId: v.parse(modelSelectionSchema, {
      providerInstanceId: 'claude',
      model: 'unused',
    }).providerInstanceId,
    driverKind: 'claude' as typeof codex.driverKind,
  }
  expect(selectTitleModel(configured, [claude, codex])).toBe(configured)
  const unavailable = v.parse(modelSelectionSchema, {
    providerInstanceId: 'disabled-custom',
    model: 'unused',
  })
  expect(selectTitleModel(unavailable, [claude, codex])).toEqual({
    providerInstanceId: 'codex',
    model: 'gpt-5.6-luna',
  })
  expect(selectTitleModel(configured, [{ ...codex, enabled: false }, claude])).toEqual({
    providerInstanceId: 'claude',
    model: 'claude-haiku-4-5',
  })
})
