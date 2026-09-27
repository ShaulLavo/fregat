import type { PromptStashEntry } from './draft-storage'
import type { ComposedMessage } from '../state/prompt-stash-store'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'

export function composedMessageEmpty(
  content: ComposedMessage,
  reviewComments: readonly SentReviewComment[] = [],
) {
  return (
    !content.prompt.trim() &&
    content.attachments.length === 0 &&
    content.terminalContexts.length === 0 &&
    reviewComments.length === 0
  )
}
export function stashMessage(
  content: ComposedMessage,
  reviewComments: readonly SentReviewComment[] = [],
): PromptStashEntry {
  return {
    prompt: content.prompt,
    reviewComments: reviewComments.map(({ anchor, author, body, quote }) => ({
      anchor,
      author,
      body,
      quote,
    })),
    terminalContexts: content.terminalContexts,
    attachments: content.attachments.map(({ dataUrl: _bytes, ...attachment }) => {
      if (!attachment.upload || attachment.upload.status !== 'ready')
        throw createClientInvariantError('The attachment is not ready to stash.')
      return { ...attachment, upload: attachment.upload }
    }),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
}
export function stashMessageLabel(entry: PromptStashEntry) {
  return (
    entry.prompt.trim() ||
    entry.attachments.map((item) => item.name).join(', ') ||
    (entry.reviewComments.length > 0 ? 'Review comments' : 'Terminal context')
  )
}
