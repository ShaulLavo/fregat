import type { PromptStashEntry } from './draft-storage'
import type { ComposedMessage } from '../state/prompt-stash-store'
import { createClientInvariantError } from '@/lib/structured-errors'

export function composedMessageEmpty(content: ComposedMessage) {
  return (
    !content.prompt.trim() &&
    content.attachments.length === 0 &&
    content.terminalContexts.length === 0
  )
}
export function stashMessage(content: ComposedMessage): PromptStashEntry {
  return {
    prompt: content.prompt,
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
    'Terminal context'
  )
}
