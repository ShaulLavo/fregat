import type { ProviderHistoryMessage, ProviderForkInput } from '../../types'
import { sessionIdentityErrors } from '../../structured-errors'

/**
 * The transcript entry a fork keeps last: the one before the first dropped user
 * prompt. Tool results carry no text, so they never count as prompts here.
 */
export function claudeForkPoint(
  history: readonly ProviderHistoryMessage[],
  fork: Pick<ProviderForkInput, 'sessionId' | 'providerTurnId'>,
) {
  const prompt = history.findIndex(
    (message) => message.sourceId === fork.providerTurnId && message.role === 'user',
  )
  const firstDropped = history.findIndex(
    (message, index) => index > prompt && message.role === 'user',
  )
  const kept = firstDropped < 0 ? history.at(-1) : history[firstDropped - 1]
  if (prompt >= 0 && kept) return kept.sourceId

  throw sessionIdentityErrors.FORK_POINT_UNAVAILABLE({
    internal: {
      providerTurnId: fork.providerTurnId,
      sourceSessionId: fork.sessionId,
    },
  })
}
