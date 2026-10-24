import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SharedTokenHighlights } from '../src/virtualization/sharedTokenHighlights'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'

const highlightsMap = new Map<string, Highlight>()
const mockRegistry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name) => highlightsMap.delete(name),
}

class MockHighlight extends Set<AbstractRange> {}

const STYLE_A = { color: '#ff0000' }
const STYLE_B = { color: '#00ff00' }

function tokenHighlightNames(): string[] {
  return [...highlightsMap.keys()].filter((name) => name.includes('-token-'))
}

describe('SharedTokenHighlights', () => {
  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Highlight')
    document.head.querySelectorAll('style').forEach((el) => el.remove())
  })

  it('shares one registry entry and Highlight across acquires of the same style', () => {
    const shared = new SharedTokenHighlights(document, mockRegistry)
    const first = shared.acquire('a', STYLE_A)
    const second = shared.acquire('a', STYLE_A)
    shared.flush()

    expect(second.name).toBe(first.name)
    expect(second.highlight).toBe(first.highlight)
    expect(highlightsMap.size).toBe(1)
  })

  it('keeps the entry until the last reference is released', () => {
    const shared = new SharedTokenHighlights(document, mockRegistry)
    shared.acquire('a', STYLE_A)
    shared.acquire('a', STYLE_A)
    shared.flush()
    expect(highlightsMap.size).toBe(1)

    shared.release('a')
    shared.flush()
    expect(highlightsMap.size).toBe(1)

    shared.release('a')
    shared.flush()
    expect(highlightsMap.size).toBe(0)
  })

  it('writes a stylesheet rule per distinct style and drops it on release', () => {
    const shared = new SharedTokenHighlights(document, mockRegistry)
    const a = shared.acquire('a', STYLE_A)
    const b = shared.acquire('b', STYLE_B)
    shared.flush()

    const styleEl = document.head.querySelector('style')
    expect(styleEl?.textContent).toContain(`::highlight(${a.name})`)
    expect(styleEl?.textContent).toContain(`::highlight(${b.name})`)

    shared.release('a')
    shared.flush()
    expect(document.head.querySelector('style')?.textContent).not.toContain(
      `::highlight(${a.name})`,
    )
    expect(document.head.querySelector('style')?.textContent).toContain(`::highlight(${b.name})`)
  })

  it('does not touch the document stylesheet until flushed', () => {
    const shared = new SharedTokenHighlights(document, mockRegistry)
    shared.acquire('a', STYLE_A)
    expect(document.head.querySelector('style')).toBeNull()

    shared.flush()
    expect(document.head.querySelector('style')).not.toBeNull()
  })

  it('shares a token Highlight across two views and removes only the disposed view ranges', () => {
    const containerA = document.createElement('div')
    const containerB = document.createElement('div')
    document.body.appendChild(containerA)
    document.body.appendChild(containerB)

    const viewA = new VirtualizedTextView(containerA, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'sel-a',
    })
    const viewB = new VirtualizedTextView(containerB, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'sel-b',
    })

    viewA.setText('hello')
    viewA.setScrollMetrics(0, 20)
    viewB.setText('world')
    viewB.setScrollMetrics(0, 20)

    viewA.setTokens([{ start: 0, end: 5, style: STYLE_A }])
    viewB.setTokens([{ start: 0, end: 5, style: STYLE_A }])

    const names = tokenHighlightNames()
    expect(names).toHaveLength(1)
    const highlight = highlightsMap.get(names[0]!)!
    expect(highlight.size).toBe(2)

    viewA.dispose()
    expect(highlightsMap.has(names[0]!)).toBe(true)
    expect(highlight.size).toBe(1)

    viewB.dispose()
    expect(highlightsMap.has(names[0]!)).toBe(false)

    containerA.remove()
    containerB.remove()
  })
})
