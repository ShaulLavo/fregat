import type { ChatInputDraft } from '@/features/chat/state/chat-input-draft-store'
import type { ChatInputSubmitResult } from '@/features/chat/utils/composed-message'

/**
 * Whether the composer may clear what it just sent. Any change to the draft while
 * sending means the user kept typing, except after a background start, where the
 * draft view itself moves the draft to its next worktree.
 */
export function sentDraftStillCurrent(
  result: ChatInputSubmitResult,
  current: ChatInputDraft,
  sent: ChatInputDraft,
) {
  if (result === 'rejected') return false
  if (result !== 'started') return current === sent

  return (
    current.prompt === sent.prompt &&
    current.attachments === sent.attachments &&
    current.terminalContexts === sent.terminalContexts
  )
}
