import assert from 'node:assert/strict'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'
import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { sessionShell, shellSnapshot } from '../test/factories/chat'

// Run with: bun apps/web/scripts/chat-snapshot-benchmark.ts
for (const count of [1_000, 4_000]) {
  const sessions = Array.from({ length: count }, (_, index) =>
    sessionShell({
      id: v.parse(sessionIdSchema, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    }),
  )
  const snapshot = shellSnapshot({ sessions })
  const empty = createInitialChatProjectionSlice()
  const populated = syncChatProjectionShellSnapshot(empty, snapshot)
  const refresh = { ...snapshot, snapshotSequence: 2 }

  for (const [mode, state] of [
    ['initial', empty],
    ['refresh', populated],
  ] as const) {
    const before = structuredClone(state)
    const samples: number[] = []
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const start = performance.now()
      const result = syncChatProjectionShellSnapshot(state, refresh)
      const elapsed = performance.now() - start
      assert.equal(result.sessionIds.length, count)
      assert.equal(Object.keys(result.sessionById).length, count)
      if (iteration < 5) continue
      samples.push(elapsed)
    }
    samples.sort((left, right) => left - right)
    assert.deepEqual(state, before)
    console.log(JSON.stringify({ sessions: count, mode, medianMs: samples[7] }))
  }
}
