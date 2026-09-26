import { MAX_CHAT_ATTACHMENTS, type ScopedSessionRef } from '@workspace/contracts'
import { useChatInputDraftStore } from './chat-input-draft-store'
import { useFollowUpStore, type QueuedFollowUp } from './follow-up-store'
import { chatInputUploadAttachments } from '../utils/input-attachments'
import { addReviewComment } from '@/lib/review-draft/state/store'

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
    for (const comment of message.content.reviewComments ?? [])
      addReviewComment({
        ...comment,
        destination: {
          environmentId: message.target.environmentId,
          rootPath: message.target.rootPath,
        },
      })
    const remaining = message.content.attachments.slice(capacity)
    if (!remaining.length) continue
    useFollowUpStore.getState().enqueue(ref, {
      ...message,
      held: true,
      submission: null,
      content: { prompt: '', attachments: remaining, terminalContexts: [], reviewComments: [] },
      payload: {
        ...message.payload,
        text: '',
        attachments: chatInputUploadAttachments(remaining),
        reviewComments: [],
        terminalContexts: [],
      },
    })
  }
  drafts.flush()
}
