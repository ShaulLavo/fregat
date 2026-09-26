import { MAX_TURN_MESSAGE_CHARS } from '@workspace/contracts'
import { messagePrompt } from '@workspace/client-core/chat/commands'
import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export function chatSubmissionValidation(
  text: string,
  contexts: readonly TerminalContextSelection[],
  reviewComments: readonly SentReviewComment[] = [],
) {
  const length = messagePrompt(text, contexts, reviewComments).length
  if (length <= MAX_TURN_MESSAGE_CHARS) return null

  const excess = (length - MAX_TURN_MESSAGE_CHARS).toLocaleString('en-US')
  const unit = length - MAX_TURN_MESSAGE_CHARS === 1 ? 'character' : 'characters'
  return `Message is ${excess} ${unit} over the ${MAX_TURN_MESSAGE_CHARS.toLocaleString('en-US')}-character limit. Shorten the message or attached terminal output.`
}
