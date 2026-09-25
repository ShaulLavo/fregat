import type { ProviderForkStart, ProviderHistoryMessage } from '../../types'
import { sessionIdentityErrors } from '../../structured-errors'

/**
 * The transcript entry a fork keeps last: the one before the first dropped user
 * prompt. Tool results carry no text, so they never count as prompts here.
 */
export function claudeForkPoint(
  history: readonly ProviderHistoryMessage[],
  fork: Pick<ProviderForkStart, 'droppedPrompts' | 'sourceSessionId'>,
) {
  const prompts = history.flatMap((message, index) => (message.role === 'user' ? [index] : []))
  const firstDropped = prompts[prompts.length - fork.droppedPrompts]
  const kept = firstDropped === undefined ? undefined : history[firstDropped - 1]
  if (kept) return kept.sourceId

  throw sessionIdentityErrors.FORK_POINT_UNAVAILABLE({
    internal: {
      droppedPrompts: fork.droppedPrompts,
      promptCount: prompts.length,
      sourceSessionId: fork.sourceSessionId,
    },
  })
}
