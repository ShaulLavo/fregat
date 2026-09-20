import { expect, test } from 'vitest'
import { FIXTURE_SESSION_ID, sessionFrom } from '../../../test/factories/orchestration'
import { correctionCommand, pendingSteerableTurn } from '../../../test/factories/provider-steering'
import { createInternalError } from '../../observability/structured-errors'

test('completed commentary keeps the provider turn open for a follow-up', async () => {
  const { fixture, corrections, release } = await pendingSteerableTurn()
  await fixture.command({
    type: 'session.message.assistant.complete',
    commandId: 'commentary-complete',
    sessionId: FIXTURE_SESSION_ID,
    turnId: 'turn-1',
    messageId: 'commentary-message',
    text: 'I will check the files now.',
    completedAt: new Date().toISOString(),
  })
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    state: 'running',
    completedAt: null,
    providerStartState: 'adopted',
  })
  await fixture.engine.dispatchClientCommand(correctionCommand())
  await expect.poll(() => corrections.length).toBe(1)
  release()
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({ state: 'completed' })
})

test('a correction reaches the active provider turn once without starting another parent turn', async () => {
  const { fixture, adapter, corrections, release } = await pendingSteerableTurn()
  const before = (await sessionFrom(fixture)).latestTurn
  await fixture.engine.dispatchClientCommand(correctionCommand())
  await expect.poll(() => corrections.length).toBe(1)
  await fixture.engine.dispatchClientCommand(correctionCommand())
  expect(corrections).toMatchObject([
    {
      sessionId: FIXTURE_SESSION_ID,
      turnId: 'turn-1',
      messageText: 'Use the existing workspace path.',
    },
  ])
  expect((await sessionFrom(fixture)).latestTurn).toEqual(before)
  expect(
    (await sessionFrom(fixture)).messages.filter((message) => message.role === 'user'),
  ).toMatchObject([
    { id: 'message-turn-1', turnId: 'turn-1', text: 'Hello' },
    { id: 'correction-message', turnId: 'turn-1', text: 'Use the existing workspace path.' },
  ])
  release()
  await fixture.engine.providerRuntimeIdle()
  expect(adapter.startedTurns).toHaveLength(1)
  expect(corrections).toHaveLength(1)
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    turnId: 'turn-1',
    state: 'completed',
  })
})

test('unsupported corrections reject before entering history', async () => {
  const { fixture, adapter } = await pendingSteerableTurn({ supported: false })
  await expect(fixture.engine.dispatchClientCommand(correctionCommand())).rejects.toThrow(
    'cannot accept a correction',
  )
  expect((await sessionFrom(fixture)).messages.map((message) => message.text)).toEqual(['Hello'])
  expect(adapter.startedTurns).toHaveLength(1)
})

test('a stale correction target is rejected before the provider or history sees it', async () => {
  const { fixture, corrections } = await pendingSteerableTurn()
  await expect(
    fixture.engine.dispatchClientCommand(correctionCommand({ turnId: 'obsolete-turn' })),
  ).rejects.toThrow('Your message was not sent')
  expect((await sessionFrom(fixture)).messages.map((message) => message.text)).toEqual(['Hello'])
  expect(corrections).toHaveLength(0)
})

test('provider delivery failure remains visible beside the accepted correction while the original turn continues', async () => {
  const { fixture, adapter, corrections } = await pendingSteerableTurn({
    failure: 'The active provider turn changed.',
  })
  await fixture.engine.dispatchClientCommand(correctionCommand())
  await expect
    .poll(async () =>
      (await sessionFrom(fixture)).activities.find(
        (activity) => activity.kind === 'provider.turn.steer.failed',
      ),
    )
    .toMatchObject({
      summary: 'Correction was not delivered',
      tone: 'error',
      turnId: 'turn-1',
      payload: { commandId: 'correct-active-turn', detail: 'The active provider turn changed.' },
    })
  expect((await sessionFrom(fixture)).latestTurn).toMatchObject({
    turnId: 'turn-1',
    state: 'running',
  })
  expect((await sessionFrom(fixture)).messages.at(-1)).toMatchObject({
    id: 'correction-message',
    text: 'Use the existing workspace path.',
  })
  expect(adapter.startedTurns).toHaveLength(1)
  expect(corrections).toHaveLength(1)
})

test('a pending correction leaves Stop available in its own and another session', async () => {
  const { fixture, adapter, release } = await pendingSteerableTurn()
  const entered = Promise.withResolvers<void>()
  const unblock = Promise.withResolvers<void>()
  adapter.steerTurn = async () => {
    entered.resolve()
    await unblock.promise
  }
  try {
    const otherSessionId = '974a8f3c-3bc1-44d1-bc82-da59e3dc6cdf'
    const session = await sessionFrom(fixture)
    await fixture.createSession(session.worktreeId, otherSessionId)
    await fixture.startTurn(otherSessionId, 'other-turn')
    await expect.poll(() => adapter.startedTurns.length).toBe(2)
    await fixture.engine.dispatchClientCommand(correctionCommand())
    await entered.promise
    for (const [sessionId, turnId] of [
      [FIXTURE_SESSION_ID, 'turn-1'],
      [otherSessionId, 'other-turn'],
    ]) {
      await fixture.engine.dispatchClientCommand({
        type: 'session.turn.interrupt',
        commandId: `stop-during-steer-${sessionId}`,
        sessionId,
        turnId,
      })
    }
    await expect
      .poll(() => adapter.interruptedSessions, { timeout: 500 })
      .toEqual([FIXTURE_SESSION_ID, otherSessionId])
    unblock.reject(createInternalError('Correction cancelled by Stop.'))
    await expect
      .poll(async () =>
        (await sessionFrom(fixture)).activities.find(
          (activity) => activity.kind === 'provider.turn.steer.failed',
        ),
      )
      .toMatchObject({ summary: 'Correction was not delivered', turnId: 'turn-1' })
    expect((await sessionFrom(fixture)).latestTurn?.state).toBe('interrupted')
  } finally {
    unblock.resolve()
    release()
    await fixture.engine.providerRuntimeIdle()
  }
})
