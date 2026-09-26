import * as v from 'valibot'
import { messageIdSchema, type SessionId } from '@workspace/contracts'
import type { ProviderHistoryMessage } from '../../provider/types'
import { historyRevision } from './import-history'

export function terminalHistoryMessages(
  sessionId: SessionId,
  startedAt: string,
  baseline: readonly string[],
  after: readonly ProviderHistoryMessage[],
) {
  const seen = new Set(baseline)
  return after.flatMap((message, index) => {
    if (seen.has(message.sourceId)) return []
    seen.add(message.sourceId)
    return [
      {
        id: v.parse(messageIdSchema, `terminal:${sessionId}:${historyRevision(message.sourceId)}`),
        role: message.role,
        text: message.text,
        attachments: [],
        turnId: null,
        createdAt: message.createdAt ?? new Date(Date.parse(startedAt) + index).toISOString(),
      },
    ]
  })
}
