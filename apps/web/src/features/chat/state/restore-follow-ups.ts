import { MAX_CHAT_ATTACHMENTS, type ScopedSessionRef } from '@workspace/contracts'
import { useChatInputDraftStore } from './chat-input-draft-store'
import { useFollowUpStore, type QueuedFollowUp } from './follow-up-store'
import { chatInputUploadAttachments } from '../utils/input-attachments'

export function restoreFollowUps(ref: ScopedSessionRef, messages: readonly QueuedFollowUp[]) {
  const drafts = useChatInputDraftStore.getState()
  for (const message of messages) {
    if (message.submission) {
      useFollowUpStore.getState().enqueue(ref, { ...message, held: true })
      continue
    }
    const current = drafts.getDraft(message.target)
    const capacity = Math.max(0, MAX_CHAT_ATTACHMENTS - current.attachments.length)
    const attachments = message.content.attachments.slice(0, capacity)
    drafts.appendContent(message.target, { ...message.content, attachments })
    const remaining = message.content.attachments.slice(capacity)
    if (!remaining.length) continue
    useFollowUpStore.getState().enqueue(ref, {
      ...message,
      held: true,
      submission: null,
      content: { prompt: '', attachments: remaining, terminalContexts: [] },
      payload: {
        ...message.payload,
        text: '',
        attachments: chatInputUploadAttachments(remaining),
        terminalContexts: [],
      },
    })
  }
  drafts.flush()
}
