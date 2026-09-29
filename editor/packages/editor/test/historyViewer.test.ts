import { describe, expect, it } from 'vitest'

import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBuffer,
} from '../src/documentSession'
import { createHistoryViewer, layoutHistoryGraph } from '../src/historyViewer'

// A, then B, undo B, then C: A has two children, C is current.
function branchedBuffer(): { buffer: EditorTextBuffer; ids: { a: number; b: number; c: number } } {
  const buffer = createEditorTextBuffer('', { now: () => 1000 })
  const session = createEditorBufferSession(buffer)
  session.applyText('A')
  session.breakTypingRun()
  session.applyText('B')
  const b = buffer.getHistoryGraph().currentId
  session.undo()
  const a = buffer.getHistoryGraph().currentId
  session.applyText('C')
  const c = buffer.getHistoryGraph().currentId
  return { buffer, ids: { a, b, c } }
}

describe('history graph layout', () => {
  it('keeps a branch on its parent lane and opens a lane per sibling', () => {
    const { buffer, ids } = branchedBuffer()
    const layout = layoutHistoryGraph(buffer.getHistoryGraph())
    const lane = (id: number) => layout.nodes.find((node) => node.id === id)?.lane

    expect(layout.columns).toBe(4)
    expect(layout.lanes).toBe(2)
    expect(lane(ids.a)).toBe(0)
    expect(lane(ids.b)).toBe(0)
    expect(lane(ids.c)).toBe(1)
    expect(layout.edges).toContainEqual({ fromId: ids.a, toId: ids.c })
  })
})

describe('history viewer', () => {
  it('focuses the current state and walks the graph without editing', () => {
    const { buffer, ids } = branchedBuffer()
    const viewer = createHistoryViewer(buffer)
    const revision = buffer.getRevision()

    expect(viewer.getState().focusedId).toBe(ids.c)
    expect(viewer.focusParent()).toBe(true)
    expect(viewer.getState().focusedId).toBe(ids.a)
    expect(viewer.focusChild()).toBe(true)
    expect(viewer.getState().focusedId).toBe(ids.c)
    expect(viewer.focusPrevious()).toBe(true)
    expect(viewer.getState().focusedId).toBe(ids.b)
    expect(viewer.focusNext()).toBe(true)
    expect(viewer.getState().focusedId).toBe(ids.c)
    expect(viewer.focusNext()).toBe(false)
    expect(buffer.getRevision()).toBe(revision)
    expect(buffer.materializeFullText()).toBe('AC')
    viewer.dispose()
  })

  it('restores a sibling branch through the buffer and every view sees it', () => {
    const { buffer, ids } = branchedBuffer()
    const other = createEditorBufferSession(buffer)
    const viewer = createHistoryViewer(buffer)
    const seen: string[] = []
    buffer.subscribe((event) => seen.push(event.change.kind))

    const change = viewer.restore(ids.b)

    expect(change.kind).toBe('checkout')
    expect(buffer.materializeFullText()).toBe('AB')
    expect(other.getSnapshot()).toBe(buffer.getSnapshot())
    expect(seen).toEqual(['checkout'])
    expect(viewer.getState().graph.currentId).toBe(ids.b)
    expect(buffer.redo().kind).toBe('none')
    expect(buffer.undo().kind).toBe('undo')
    expect(buffer.redo().kind).toBe('redo')
    expect(buffer.materializeFullText()).toBe('AB')
    viewer.dispose()
  })

  it('compares two selected states and drops a late result', async () => {
    const { buffer, ids } = branchedBuffer()
    const resolvers: ((value: string) => void)[] = []
    const viewer = createHistoryViewer<string>(buffer, {
      compare: (left, right) =>
        new Promise((resolve) => {
          resolvers.push((value) => resolve(`${value}:${left.id}->${right.id}`))
        }),
    })

    viewer.toggleSelection(ids.b)
    viewer.toggleSelection(ids.c)
    expect(viewer.getState().comparison).toMatchObject({ status: 'pending' })
    expect(resolvers).toHaveLength(1)

    // A third selection replaces the oldest; the first request is now stale.
    viewer.toggleSelection(ids.a)
    expect(viewer.getState().selectedIds).toEqual([ids.c, ids.a])
    expect(resolvers).toHaveLength(2)
    resolvers[0]!('late')
    await Promise.resolve()
    expect(viewer.getState().comparison).toMatchObject({ status: 'pending' })

    resolvers[1]!('fresh')
    await Promise.resolve()
    expect(viewer.getState().comparison).toMatchObject({
      status: 'ready',
      result: `fresh:${ids.c}->${ids.a}`,
    })
    viewer.dispose()
  })

  it('re-requests a comparison when an amended node changes revision', () => {
    const buffer = createEditorTextBuffer('')
    const session = createEditorBufferSession(buffer)
    session.applyText('a')
    const typing = buffer.getHistoryGraph().currentId
    let requests = 0
    const viewer = createHistoryViewer(buffer, {
      compare: async () => {
        requests += 1
        return requests
      },
    })
    viewer.toggleSelection(0)
    viewer.toggleSelection(typing)
    expect(requests).toBe(1)

    session.applyText('b')
    expect(buffer.getHistoryGraph().currentId).toBe(typing)
    expect(requests).toBe(2)
    viewer.dispose()
  })

  it('reports pruned states and moves focus back to the current one', () => {
    const buffer = createEditorTextBuffer('', { retainedHistoryStates: 2 })
    const session = createEditorBufferSession(buffer)
    session.applyText('a')
    session.breakTypingRun()
    session.applyText('b')
    const b = buffer.getHistoryGraph().currentId
    session.undo()
    session.undo()
    const viewer = createHistoryViewer(buffer)
    viewer.focus(b)
    viewer.toggleSelection(b)

    session.applyText('c')

    const state = viewer.getState()
    expect(state.graph.nodes.some((node) => node.id === b)).toBe(false)
    expect(state.lostIds).toEqual([b, b])
    expect(state.focusedId).toBe(state.graph.currentId)
    expect(state.selectedIds).toEqual([])
    expect(state.comparison).toBeNull()

    session.breakTypingRun()
    session.applyText('d')
    expect(viewer.getState().lostIds).toEqual([])
    viewer.dispose()
  })

  it('lets an explicit pick acknowledge a pruning notice', () => {
    const buffer = createEditorTextBuffer('', { retainedHistoryStates: 2 })
    const session = createEditorBufferSession(buffer)
    session.applyText('a')
    session.breakTypingRun()
    session.applyText('b')
    const b = buffer.getHistoryGraph().currentId
    session.undo()
    session.undo()
    const viewer = createHistoryViewer(buffer)
    viewer.focus(b)
    session.applyText('c')
    expect(viewer.getState().lostIds).toEqual([b])

    expect(viewer.focus(0)).toBe(true)
    expect(viewer.getState().lostIds).toEqual([])
    viewer.dispose()
  })

  it('follows the current state until focus is moved elsewhere', () => {
    const buffer = createEditorTextBuffer('')
    const session = createEditorBufferSession(buffer)
    const viewer = createHistoryViewer(buffer)

    session.applyText('a')
    expect(viewer.getState().focusedId).toBe(buffer.getHistoryGraph().currentId)

    viewer.focus(0)
    session.breakTypingRun()
    session.applyText('b')
    expect(viewer.getState().focusedId).toBe(0)
    viewer.dispose()
  })

  it('clears every state but the current one without changing text', () => {
    const { buffer, ids } = branchedBuffer()
    const viewer = createHistoryViewer(buffer)
    const revision = buffer.getRevision()

    const cleared = buffer.clearHistory()
    expect(cleared.kind).toBe('checkout')
    expect(cleared.logicalRevisionCount).toBe(0)
    expect(buffer.getRevision()).toBe(revision)
    expect(buffer.materializeFullText()).toBe('AC')
    expect(buffer.canUndo()).toBe(false)
    expect(viewer.getState().graph.nodes).toHaveLength(1)
    expect(viewer.getState().lostIds).toEqual([ids.c])
    expect(buffer.clearHistory().kind).toBe('none')
    viewer.dispose()
  })

  it('stops listening after dispose', () => {
    const { buffer } = branchedBuffer()
    const viewer = createHistoryViewer(buffer)
    let notified = 0
    viewer.subscribe(() => {
      notified += 1
    })
    viewer.dispose()
    createEditorBufferSession(buffer).applyText('!')

    expect(notified).toBe(0)
    expect(viewer.focus(0)).toBe(false)
  })
})
