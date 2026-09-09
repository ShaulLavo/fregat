import * as v from 'valibot'
import {
  orchestrationSessionDetailSnapshotSchema,
  orchestrationShellSnapshotSchema,
  type SessionId,
} from '@workspace/contracts'

import type { Client } from '../transport/client'
import { requireEdenData } from '../transport/eden'
import { normalizeEdenDates } from '../transport/normalize-dates'

export async function readChatShell(client: Client, signal: AbortSignal) {
  const response = await client.orchestration['shell-snapshot'].get({
    fetch: { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) },
  })
  signal.throwIfAborted()
  return v.parse(orchestrationShellSnapshotSchema, normalizeEdenDates(requireEdenData(response)))
}

export async function readChatSession(client: Client, sessionId: SessionId, signal: AbortSignal) {
  const response = await client.orchestration['session-detail'].get({
    query: { sessionId },
    fetch: { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) },
  })
  signal.throwIfAborted()
  return v.parse(
    orchestrationSessionDetailSnapshotSchema,
    normalizeEdenDates(requireEdenData(response)),
  )
}
