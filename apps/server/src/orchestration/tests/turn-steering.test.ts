import { expect, test } from 'vitest'
import { FIXTURE_SESSION_ID, sessionFrom } from '../../../test/factories/orchestration'
import { correctionCommand, pendingSteerableTurn } from '../../../test/factories/provider-steering'

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
