import { QueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'
import { messageIdSchema, sessionIdSchema, turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test } from 'vitest'

import { turnHunksQueryOptions } from '@/features/chat-mode/utils/checkpoint-hunks'
import type { Client } from '@/lib/client'
import { cachedCountedTurnDiff, checkpointDiffInputForSummary } from '@/lib/checkpoint-diff-query'

const sessionId = v.parse(sessionIdSchema, '974a8f3c-3bc1-44d1-bc82-da59e3dc6cde')

test('opening a file from the chat git pane reuses the turn the pane already fetched', () => {
  const client = new QueryClient()
  const pane = turnHunksQueryOptions({} as Client, sessionId, 3)
  const diffs = [{ path: 'src/a.ts' }] as unknown as GitFileDiff[]
  client.setQueryData(pane.queryKey, diffs)
  const open = checkpointDiffInputForSummary({
    assistantMessageId: v.parse(messageIdSchema, 'assistant:turn-3'),
    checkpointRef: 'refs/platform/checkpoints/3',
    checkpointTurnCount: 3,
    completedAt: '2026-09-26T12:00:00.000Z',
    files: [],
    sessionId,
    status: 'ready',
    turnId: v.parse(turnIdSchema, 'turn-3'),
  })

  expect(cachedCountedTurnDiff(client, open)).toBe(diffs)
})
