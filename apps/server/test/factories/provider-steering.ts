import { createInternalError } from '../../src/observability/structured-errors'
import { MockProviderAdapter } from '../../src/provider/adapters/mock'
import type { ProviderAdapter, ProviderTurnSteerInput } from '../../src/provider/types'
import { FIXTURE_SESSION_ID } from './orchestration'
import { startPendingProviderTurn } from './pending-provider'

export async function pendingSteerableTurn(
  options: { supported?: boolean; failure?: string } = {},
) {
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
  const pending = await startPendingProviderTurn({
    adapter,
    started: started.promise,
    release: () => release.resolve(),
  })
  return { ...pending, corrections }
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
