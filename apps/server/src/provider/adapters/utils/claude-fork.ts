import type { ProviderHistoryMessage, ProviderSessionHistoryInput } from '../../types'
import { sessionIdentityErrors } from '../../structured-errors'

/**
 * The transcript entry a fork keeps last: the one before the first dropped user
 * prompt. Tool results carry no text, so they never count as prompts here.
 */
export function claudeForkPoint(
  history: readonly ProviderHistoryMessage[],
  fork: Pick<ProviderSessionHistoryInput, 'sessionId'> & { keptPrompts: number },
) {
  const prompts = history.flatMap((message, index) => (message.role === 'user' ? [index] : []))
  const firstDropped = prompts[fork.keptPrompts]
  const kept = firstDropped === undefined ? history.at(-1) : history[firstDropped - 1]
  if (kept && fork.keptPrompts > 0 && fork.keptPrompts <= prompts.length) return kept.sourceId

  throw sessionIdentityErrors.FORK_POINT_UNAVAILABLE({
    internal: {
      keptPrompts: fork.keptPrompts,
      promptCount: prompts.length,
      sourceSessionId: fork.sessionId,
    },
  })
}
