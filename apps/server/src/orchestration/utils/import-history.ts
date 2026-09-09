import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { messageIdSchema, type SessionId } from '@workspace/contracts'
import type { ProviderHistoryMessage } from '../../provider/types'

export function importedHistoryMessages(
  sessionId: SessionId,
  importedAt: string,
  history: readonly ProviderHistoryMessage[],
) {
  return history.map((message, index) => ({
    // The ordinal preserves source order when a provider has no message timestamps.
    id: v.parse(
      messageIdSchema,
      `import:${sessionId}:${String(index).padStart(10, '0')}:${historyRevision(message.sourceId)}`,
    ),
    role: message.role,
    text: message.text,
    createdAt: message.createdAt ?? importedAt,
  }))
}

export function historyRevision(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
