import { describe, expect, it, vi } from 'vitest'
import type { TerminalScrollbar } from 'ghostty-webgpu'
import { createReplayGate } from '@/features/terminal/state/replay'

function fixture(saved: TerminalScrollbar | null = null) {
  const operations: string[] = []
  const terminal = {
    scrollBy: vi.fn((delta: number) => {
      operations.push(`scroll:${delta}`)
      return { revision: 0 }
    }),
    refresh: vi.fn(() => {
      operations.push('refresh')
    }),
    appearance: { grid: { rows: 24 } },
  }
  const onReady = vi.fn((ready: boolean) => {
    operations.push(`ready:${ready}`)
  })
  const gate = createReplayGate({ terminal, getSavedScroll: () => saved, onReady })
  return { gate, terminal, onReady, operations }
}

describe('terminal replay admission', () => {
  it('admits input only after replay completion and a subsequent native paint', () => {
    const { gate, onReady } = fixture()
    gate.paint()
    expect(onReady).not.toHaveBeenCalled()
    gate.complete()
    expect(onReady).not.toHaveBeenCalled()
    gate.paint()
    expect(onReady).toHaveBeenCalledExactlyOnceWith(true)
    gate.paint()
    gate.complete()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('restores the saved distance from bottom before refreshing the handoff frame', () => {
    const { gate, operations } = fixture({ offset: 10, length: 24, total: 100 })
    gate.complete()
    expect(operations).toEqual(['scroll:-66', 'refresh'])
    gate.paint()
    expect(operations.at(-1)).toBe('ready:true')
    gate.begin()
    gate.complete()
    expect(operations.filter((op) => op.startsWith('scroll:'))).toHaveLength(1)
  })

  it('cannot admit a late frame or replay marker after closing', () => {
    const { gate, onReady } = fixture()
    gate.complete()
    gate.close()
    gate.begin()
    gate.complete()
    gate.paint()
    expect(onReady).toHaveBeenCalledExactlyOnceWith(false)
  })
})
