import { expect, onTestFinished } from 'vitest'
import { createInternalError } from '../../src/observability/structured-errors'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import type { ProviderAdapter, ProviderTurnSteerInput } from '../../src/provider/types'
import { createOrchestrationFixture, FIXTURE_SESSION_ID, mockRuntime } from './orchestration'

export async function pendingSteerableTurn(
  options: { supported?: boolean; failure?: string } = {},
) {
  const fixture = await createOrchestrationFixture()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const adapter: MockProviderAdapter & Pick<ProviderAdapter, 'steerTurn'> = new MockProviderAdapter(
    {
      beforeComplete: async () => {
        started.resolve()
        await release.promise
      },
    },
  )
  const corrections: ProviderTurnSteerInput[] = []
  if (options.supported !== false)
    adapter.steerTurn = async (input) => {
      corrections.push(input)
      if (options.failure) throw createInternalError(options.failure)
    }
  onTestFinished(async () => {
    release.resolve()
    await fixture.engine.providerRuntimeIdle()
    await fixture.close()
  })
  const registration = await fixture.register()
  expect(registration.result).not.toBeNull()
  await fixture.createSession(registration.result!.worktreeId)
  await fixture.restart(mockRuntime(adapter))
  await fixture.startTurn()
  await started.promise
  return { fixture, adapter, corrections, release: () => release.resolve() }
}

export function correctionCommand(overrides: { commandId?: string; turnId?: string } = {}) {
  return {
    type: 'session.turn.steer',
    commandId: overrides.commandId ?? 'correct-active-turn',
    sessionId: FIXTURE_SESSION_ID,
    turnId: overrides.turnId ?? 'turn-1',
    message: {
      messageId: 'correction-message',
      role: 'user',
      text: 'Use the existing workspace path.',
      attachments: [],
    },
  }
}
