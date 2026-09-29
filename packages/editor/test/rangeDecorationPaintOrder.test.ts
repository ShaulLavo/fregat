import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { rangeDecorationsWithProjectionStacking } from '../src/editor/rangeDecorations'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'

// The CSS highlight registry is maplike: paint order for highlights that share a priority is the
// order they were inserted in, so a Map-backed mock reproduces the ordering faithfully.
const highlightsMap = new Map<string, Highlight>()
const mockRegistry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {
  priority = 0
}

const ROW_HEIGHT = 20
const LINE_LENGTH = 'line00'.length + 1

function rangeHighlightNames(): readonly string[] {
  return [...highlightsMap.keys()].filter((name) => name.startsWith('test-'))
}

function createLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line${String(index).padStart(2, '0')}`).join(
    '\n',
  )
}

describe('range decoration paint order', () => {
  let container: HTMLElement

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  describe('VirtualizedTextView', () => {
    let view: VirtualizedTextView

    beforeEach(() => {
      view = new VirtualizedTextView(container, {
        rowHeight: ROW_HEIGHT,
        overscan: 0,
        highlightRegistry: mockRegistry,
        selectionHighlightName: 'test-selection',
      })
      view.setText(createLines(40))
      view.setScrollMetrics(0, ROW_HEIGHT)
    })

    afterEach(() => {
      view.dispose()
    })

    it('keeps registry order for equal-priority groups across a mount-out and mount-in cycle', () => {
      // "under" only ever covers row 0; "over" also covers a row far below, so scrolling away
      // empties the first group while leaving the second one mounted.
      view.setRangeHighlight('test-under', [{ start: 0, end: 4 }], { backgroundColor: 'blue' })
      view.setRangeHighlight(
        'test-over',
        [
          { start: 2, end: 6 },
          { start: LINE_LENGTH * 30, end: LINE_LENGTH * 30 + 4 },
        ],
        { backgroundColor: 'red' },
      )

      expect(rangeHighlightNames()).toEqual(['test-under', 'test-over'])

      view.setScrollMetrics(ROW_HEIGHT * 30, ROW_HEIGHT)
      view.setScrollMetrics(0, ROW_HEIGHT)

      expect(highlightsMap.get('test-under')?.size).toBe(1)
      expect(rangeHighlightNames()).toEqual(['test-under', 'test-over'])
    })

    it('mirrors the declared stacking onto the highlight priority and keeps it while offscreen', () => {
      view.setRangeHighlight('test-under', [{ start: 0, end: 4 }], {
        backgroundColor: 'blue',
        zIndex: 1,
      })
      view.setRangeHighlight('test-over', [{ start: 2, end: 6 }], {
        backgroundColor: 'red',
        zIndex: 2,
      })

      expect(highlightsMap.get('test-under')?.priority).toBe(-99)
      expect(highlightsMap.get('test-over')?.priority).toBe(-98)

      view.setScrollMetrics(ROW_HEIGHT * 30, ROW_HEIGHT)
      view.setScrollMetrics(0, ROW_HEIGHT)

      expect(highlightsMap.get('test-under')?.priority).toBe(-99)
      expect(highlightsMap.get('test-over')?.priority).toBe(-98)
    })

    it('keeps a colorless wash below syntax without moving a color producer', () => {
      view.setRangeHighlight('test-wash', [{ start: 0, end: 4 }], {
        backgroundColor: 'blue',
        zIndex: 2,
      })
      view.setRangeHighlight('test-color', [{ start: 0, end: 4 }], { color: 'red', zIndex: 2 })
      expect(highlightsMap.get('test-wash')?.priority).toBe(-98)
      expect(highlightsMap.get('test-color')?.priority).toBe(2)
    })

    it('restacks an existing group when its declared stacking changes', () => {
      view.setRangeHighlight('test-under', [{ start: 0, end: 4 }], { backgroundColor: 'blue' })
      const highlight = highlightsMap.get('test-under')

      view.setRangeHighlight('test-under', [{ start: 0, end: 4 }], {
        backgroundColor: 'blue',
        zIndex: 3,
      })

      expect(highlightsMap.get('test-under')).toBe(highlight)
      expect(highlight?.priority).toBe(-97)
    })
  })

  describe('Editor', () => {
    let editor: Editor

    beforeEach(() => {
      setHighlightRegistry(mockRegistry)
      editor = new Editor(container, { defaultText: 'alpha beta gamma' })
    })

    afterEach(() => {
      editor.dispose()
      setHighlightRegistry(undefined)
    })

    it('propagates a decoration zIndex to the highlight priority', () => {
      editor.setRangeDecorations([
        {
          start: 0,
          end: 5,
          className: 'occurrence',
          style: { backgroundColor: 'blue' },
          zIndex: 1,
        },
        {
          start: 0,
          end: 5,
          className: 'find-match',
          style: { backgroundColor: 'red' },
          zIndex: 2,
        },
      ])

      const occurrence = [...highlightsMap].find(([name]) => name.includes('occurrence'))
      const findMatch = [...highlightsMap].find(([name]) => name.includes('find-match'))

      expect(occurrence?.[1].priority).toBe(-99)
      expect(findMatch?.[1].priority).toBe(-98)
    })

    it('groups decorations in ascending zIndex regardless of input order', () => {
      editor.setRangeDecorations([
        {
          start: 0,
          end: 5,
          className: 'find-match',
          style: { backgroundColor: 'red' },
          zIndex: 2,
        },
        {
          start: 0,
          end: 5,
          className: 'occurrence',
          style: { backgroundColor: 'blue' },
          zIndex: 1,
        },
      ])

      const names = [...highlightsMap.keys()].filter(
        (name) => name.includes('occurrence') || name.includes('find-match'),
      )

      expect(names.map((name) => name.split('-').at(-1))).toEqual(['0', '1'])
      expect(names[0]).toContain('occurrence')
      expect(names[1]).toContain('find-match')
    })

    it('keeps decorations that differ only in zIndex in separate groups', () => {
      editor.setRangeDecorations([
        { start: 0, end: 5, className: 'layered', style: { backgroundColor: 'blue' }, zIndex: 1 },
        { start: 6, end: 10, className: 'layered', style: { backgroundColor: 'blue' }, zIndex: 2 },
      ])

      const entries = [...highlightsMap].filter(([name]) => name.includes('layered'))

      expect(entries).toHaveLength(2)
      expect(entries.map(([, highlight]) => highlight.priority)).toEqual([-99, -98])
    })

    it('repaints a decoration set that changed only its stacking', () => {
      const decoration = { start: 0, end: 5, className: 'restacked', style: { color: 'red' } }
      editor.setRangeDecorations([{ ...decoration, zIndex: 1 }])
      editor.setRangeDecorations([{ ...decoration, zIndex: 4 }])

      const entry = [...highlightsMap].find(([name]) => name.includes('restacked'))

      // The equality short-circuit in setRangeDecorations must not treat a
      // stacking-only change as no change, or the highlight keeps the old
      // priority and the user sees the previous paint order.
      expect(entry?.[1].priority).toBe(4)
    })
  })

  describe('projection stacking', () => {
    it('defaults each projection to its position in the registry order', () => {
      const decoration = { start: 0, end: 5, className: 'x' }

      expect(
        rangeDecorationsWithProjectionStacking([
          [decoration, { ...decoration, start: 6, end: 8 }],
          [{ ...decoration, start: 9, end: 12 }],
        ]).map((entry) => entry.zIndex),
      ).toEqual([0, 0, 1])
    })

    it('leaves a declared stacking alone', () => {
      const decoration = { start: 0, end: 5, className: 'x' }

      expect(
        rangeDecorationsWithProjectionStacking([[{ ...decoration, zIndex: 7 }], [decoration]]).map(
          (entry) => entry.zIndex,
        ),
      ).toEqual([7, 1])
    })
  })
})
