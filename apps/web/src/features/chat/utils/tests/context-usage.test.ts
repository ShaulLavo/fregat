import {
  eventIdSchema,
  sessionIdSchema,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  CONTEXT_WINDOW_ACTIVITY_KIND,
  contextUsageForActivities,
  contextUsageForPayload,
  formatContextTokens,
} from '@workspace/client-core/chat/context-usage'
import { expect, test } from '../../../../../test/fixtures'

test('reads the used and maximum token counts a provider reports', () => {
  const usage = contextUsageForPayload({
    compactsAutomatically: true,
    maxTokens: 200_000,
    totalProcessedTokens: 500_000,
    usedTokens: 50_000,
  })

  expect(usage).toEqual({
    compactsAutomatically: true,
    maxTokens: 200_000,
    ratio: 0.25,
    totalProcessedTokens: 500_000,
    usedTokens: 50_000,
  })
})

test('still reports occupancy when the provider omits the window size', () => {
  // Claude's per-turn result usage looks exactly like this.
  expect(contextUsageForPayload({ input_tokens: 10, usedTokens: 4200 })).toEqual({
    compactsAutomatically: false,
    maxTokens: null,
    ratio: null,
    totalProcessedTokens: null,
    usedTokens: 4200,
  })
})

test('has nothing to show without a used-token count', () => {
  expect(contextUsageForPayload({ maxTokens: 200_000 })).toBeNull()
  expect(contextUsageForPayload(null)).toBeNull()
})

test('clamps a provider that over-reports rather than painting past full', () => {
  expect(contextUsageForPayload({ maxTokens: 100, usedTokens: 250 })?.ratio).toBe(1)
})

test('takes the newest count and carries the last known window size onto it', () => {
  const usage = contextUsageForActivities([
    activity(1, { maxTokens: 200_000, usedTokens: 10_000 }),
    activity(2, { maxTokens: 200_000, usedTokens: 90_000 }),
    // A per-turn snapshot with no window of its own: the count is current, the
    // window belongs to the session and is still the one reported before it.
    activity(3, { usedTokens: 20_000 }),
  ])

  expect(usage).toMatchObject({ maxTokens: 200_000, ratio: 0.1, usedTokens: 20_000 })
})

test('reports a window-less session rather than hiding the gauge', () => {
  const usage = contextUsageForActivities([activity(1, { usedTokens: 4200 })])

  expect(usage).toMatchObject({ maxTokens: null, ratio: null, usedTokens: 4200 })
})

test('ignores activities that are not context-window snapshots', () => {
  const unrelated: OrchestrationSessionActivity = {
    ...activity(1, { maxTokens: 200_000, usedTokens: 10 }),
    kind: 'context-compaction',
  }

  expect(contextUsageForActivities([unrelated])).toBeNull()
})

test('abbreviates token counts for a gauge that has no room', () => {
  expect(formatContextTokens(940)).toBe('940')
  expect(formatContextTokens(12_400)).toBe('12.4k')
  expect(formatContextTokens(200_000)).toBe('200k')
  expect(formatContextTokens(1_250_000)).toBe('1.3M')
})

function activity(index: number, payload: unknown): OrchestrationSessionActivity {
  return {
    createdAt: `2026-05-28T00:00:0${index}.000Z`,
    id: v.parse(eventIdSchema, `event-${index}`),
    kind: CONTEXT_WINDOW_ACTIVITY_KIND,
    payload,
    summary: 'Context window updated',
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    tone: 'info',
    turnId: null,
  }
}
