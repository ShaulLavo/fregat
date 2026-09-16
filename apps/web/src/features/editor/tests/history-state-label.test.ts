import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core'
import { describe, expect, it } from 'vitest'

import { adjacentHistoryState } from '@/features/editor/utils/history-navigation'
import {
  historyStateExcerpt,
  historyStateLabel,
  historyStateSummary,
  relativeTimeLabel,
} from '@/features/editor/utils/history-state-label'

function typedBuffer() {
  const buffer = createEditorTextBuffer('', { now: () => 60_000 })
  const session = createEditorBufferSession(buffer)
  session.applyText('alpha\nbeta')
  session.breakTypingRun()
  session.backspace()
  return buffer
}

describe('history state labels', () => {
  it('summarises the intent with the character delta', () => {
    const nodes = typedBuffer().getHistoryGraph().nodes
    expect(historyStateSummary(nodes[0]!)).toBe('Opened')
    expect(historyStateSummary(nodes[1]!)).toBe('Typed +10')
    expect(historyStateSummary(nodes[2]!)).toBe('Backspace -1')
  })

  it('shows the first inserted line and nothing for a removal', () => {
    const nodes = typedBuffer().getHistoryGraph().nodes
    expect(historyStateExcerpt(nodes[1]!)).toBe('alpha')
    expect(historyStateExcerpt(nodes[2]!)).toBeNull()
  })

  it('names the current state and its age', () => {
    const nodes = typedBuffer().getHistoryGraph().nodes
    expect(historyStateLabel(nodes[2]!, 60_000 + 90_000)).toBe('Backspace -1, 2 min ago, current')
    expect(relativeTimeLabel(0, 3_000)).toBe('just now')
    expect(relativeTimeLabel(0, 45_000)).toBe('45s ago')
    expect(relativeTimeLabel(0, 3 * 3_600_000)).toBe('3 h ago')
  })

  it('steps to the neighbouring state in sequence order', () => {
    const buffer = typedBuffer()
    const graph = buffer.getHistoryGraph()
    expect(adjacentHistoryState(graph, 1)).toBeNull()
    expect(adjacentHistoryState(graph, -1)).toBe(graph.nodes[1]!.id)
    buffer.undo()
    expect(adjacentHistoryState(buffer.getHistoryGraph(), 1)).toBe(graph.nodes[2]!.id)
  })
})
