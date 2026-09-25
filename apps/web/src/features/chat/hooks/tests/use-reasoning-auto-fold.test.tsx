import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'

import { useReasoningAutoFold } from '@/features/chat/hooks/use-reasoning-auto-fold'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import { workLogEntry } from '../../../../../test/factories/work-log'
import { expect, test } from '../../../../../test/fixtures'

function reasoningItem(streaming: boolean): ChatTimelineItem {
  const entry = workLogEntry({ id: 'think', reasoning: true, tone: 'thinking' })
  return { entry, id: 'reasoning:think', streaming, timestamp: entry.createdAt, type: 'reasoning' }
}

function autoState() {
  return useChatWorkLogExpansionStore.getState().autoExpandedRowIds.think
}

test('opens streaming reasoning and folds it a second after, only while following', () => {
  vi.useFakeTimers()
  useChatWorkLogExpansionStore.setState({ autoExpandedRowIds: {}, userExpandedRowIds: {} })
  const { rerender } = renderHook(
    ({ items, following }) => useReasoningAutoFold(items, following),
    { initialProps: { following: false, items: [reasoningItem(true)] } },
  )
  expect(autoState()).toBeUndefined()

  rerender({ following: true, items: [reasoningItem(true)] })
  expect(autoState()).toBe(true)

  rerender({ following: false, items: [reasoningItem(false)] })
  act(() => vi.advanceTimersByTime(5_000))
  expect(autoState()).toBe(true)

  rerender({ following: true, items: [reasoningItem(false)] })
  act(() => vi.advanceTimersByTime(999))
  expect(autoState()).toBe(true)
  act(() => vi.advanceTimersByTime(1))
  expect(autoState()).toBe(false)
  vi.useRealTimers()
})
