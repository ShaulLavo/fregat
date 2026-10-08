import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSemanticTokenStyles } from '../src/syntax'
import { SEMANTIC_TOKEN_Z_INDEX } from '../src/semanticTokenLayer'
import type { VirtualizedTextHighlightStyle } from '../src/virtualization'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'

class MockHighlight extends Set<Range> {
  priority = 0
  clears = 0
  adds = 0

  override clear(): void {
    this.clears += 1
    super.clear()
  }

  override add(range: Range): this {
    this.adds += 1
    return super.add(range)
  }
}

const ROW_COUNT = 200
const VIEWPORT_ROWS = 20
const ROW_HEIGHT = 20
const RANGES_PER_GROUP = 20
const KEYSTROKES = 12
const FIND_GROUPS = 3

interface RepaintWork {
  groupVisits: number
  clears: number
  rangeAdds: number
}

const highlights = new Map<string, Highlight>()
const registry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlights.set(name, highlight)
  },
  delete: (name) => highlights.delete(name),
}

function documentText(): string {
  return Array.from(
    { length: ROW_COUNT },
    (_, row) => `const value${row} = compute(${row}, 'text', other.property)`,
  ).join('\n')
}

function liveGroupCount(): number {
  const styles = createSemanticTokenStyles({ zIndex: SEMANTIC_TOKEN_Z_INDEX })
  const viewportTypes: readonly (readonly [string, readonly string[]])[] = [
    ['keyword', []],
    ['variable', []],
    ['variable', ['readonly']],
    ['variable', ['defaultLibrary']],
    ['parameter', []],
    ['property', []],
    ['function', []],
    ['method', []],
    ['class', []],
    ['interface', []],
    ['type', []],
    ['namespace', []],
    ['string', []],
    ['number', []],
    ['comment', []],
    ['operator', []],
  ]

  return new Set(
    viewportTypes.map(([type, modifiers]) => JSON.stringify(styles.resolve(type, modifiers))),
  ).size
}

function groupStyle(index: number): VirtualizedTextHighlightStyle {
  return { color: `rgb(${index % 256}, 100, 100)`, zIndex: SEMANTIC_TOKEN_Z_INDEX }
}

function perKeystrokeWork(groupCount: number): RepaintWork {
  const container = document.createElement('div')
  document.body.appendChild(container)
  highlights.clear()

  const view = new VirtualizedTextView(container, {
    highlightRegistry: registry,
    overscan: 0,
    rowHeight: ROW_HEIGHT,
  })
  const internal = Reflect.get(view, 'view') as VirtualizedTextViewInternal
  let text = documentText()
  view.setText(text)
  view.setScrollMetrics(0, ROW_HEIGHT * VIEWPORT_ROWS)

  const rowLength = text.indexOf('\n') + 1
  const viewportEnd = rowLength * VIEWPORT_ROWS
  const push = (shift: number): void => {
    for (let group = 0; group < groupCount; group += 1) {
      const ranges: { start: number; end: number }[] = []
      for (let index = 0; index < RANGES_PER_GROUP; index += 1) {
        const start = ((group * 7 + index * 23) % (viewportEnd - 40)) + shift
        ranges.push({ start, end: start + 6 })
      }
      view.setRangeHighlight(`bench-${group}`, ranges, groupStyle(group))
    }
  }

  try {
    // The first shifted push must repaint every group, including groups outside the edited row.
    push(2)

    const groups = [...internal.rangeHighlightGroups.values()]
    const painted = groups
      .map((group) => group.highlight)
      .filter((highlight) => highlight instanceof MockHighlight)
    for (const highlight of painted) {
      highlight.clears = 0
      highlight.adds = 0
    }

    const work: RepaintWork = { groupVisits: 0, clears: 0, rangeAdds: 0 }
    const values = internal.rangeHighlightGroups.values.bind(internal.rangeHighlightGroups)
    // Unchanged CSS text hides repeated rule construction from a DOM-write counter.
    const visits = vi
      .spyOn(internal.rangeHighlightGroups, 'values')
      .mockImplementation(function* () {
        for (const group of values()) {
          work.groupVisits += 1
          yield group
        }
        return undefined
      })

    try {
      const editOffset = 6
      for (let keystroke = 0; keystroke < KEYSTROKES; keystroke += 1) {
        text = `${text.slice(0, editOffset)}x${text.slice(editOffset)}`
        view.applyEdit({ from: editOffset, to: editOffset, text: 'x' }, text)
        push(keystroke % 3)
      }
    } finally {
      visits.mockRestore()
    }

    for (const highlight of painted) {
      work.clears += highlight.clears
      work.rangeAdds += highlight.adds
    }
    return work
  } finally {
    view.dispose()
    container.remove()
  }
}

describe('the per-keystroke work of repainting semantic groups', () => {
  beforeEach(() => {
    vi.stubGlobal('Highlight', MockHighlight)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    highlights.clear()
  })

  it('repaints each live group once per keystroke with bounded group traversal', () => {
    const live = liveGroupCount()
    expect(live).toBeGreaterThan(FIND_GROUPS)
    const measured = new Map<number, RepaintWork>()
    for (const groupCount of [0, 1, FIND_GROUPS, 12, live]) {
      const work = perKeystrokeWork(groupCount)
      measured.set(groupCount, work)
      expect(work.clears, `N=${groupCount} repaints`).toBe(KEYSTROKES * groupCount)
      expect(work.rangeAdds, `N=${groupCount} visible ranges`).toBeGreaterThanOrEqual(
        KEYSTROKES * groupCount * RANGES_PER_GROUP,
      )
      expect(work.rangeAdds, `N=${groupCount} row-split ranges`).toBeLessThanOrEqual(
        KEYSTROKES * groupCount * RANGES_PER_GROUP * 2,
      )
      // A pass per edit is linear; a pass per pushed group restores the quadratic CSS-rule bug.
      expect(work.groupVisits, `N=${groupCount} group visits`).toBeLessThanOrEqual(
        KEYSTROKES * groupCount,
      )
    }
    expect(
      measured.get(live)!.rangeAdds / measured.get(FIND_GROUPS)!.rangeAdds,
    ).toBeLessThanOrEqual(6)
  })
})
