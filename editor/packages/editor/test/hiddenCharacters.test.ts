import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLineGutterContribution } from '../../gutters/src/index.ts'
import { createInlineMap } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'
import {
  type VirtualizedTextHighlightRegistry,
  type VirtualizedTextViewOptions,
  VirtualizedTextView,
} from '../src/virtualization'

// Counts the geometry lookups a render pass makes, which is the cost the marker gate exists to
// keep off a row that has not changed.
const geometry = vi.hoisted(() => ({ lookups: 0 }))
// The order a render pass asks the layout questions in and answers them in, while recording is on.
const renderPhases = vi.hoisted(() => ({ events: null as ('read' | 'write')[] | null }))
// Asking for the glyph is a question about the font whether or not the answer is already known, and
// a remembered answer reaches no probe — so the ask itself has to be what gets counted, or a
// measurement moved into the drawing looks free.
const glyphAsks = vi.hoisted(() => ({ count: 0 }))

vi.mock('../src/virtualization/virtualizedTextViewGeometry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/virtualization/virtualizedTextViewGeometry')>()
  return {
    ...actual,
    offsetToX: (...args: Parameters<typeof actual.offsetToX>) => {
      geometry.lookups += 1
      renderPhases.events?.push('read')
      return actual.offsetToX(...args)
    },
    unitRectForOffset: (...args: Parameters<typeof actual.unitRectForOffset>) => {
      geometry.lookups += 1
      renderPhases.events?.push('read')
      return actual.unitRectForOffset(...args)
    },
  }
})

vi.mock('../src/virtualization/browserMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/virtualization/browserMetrics')>()
  return {
    ...actual,
    measureWhitespaceDotGlyph: (...args: Parameters<typeof actual.measureWhitespaceDotGlyph>) => {
      glyphAsks.count += 1
      renderPhases.events?.push('read')
      return actual.measureWhitespaceDotGlyph(...args)
    },
  }
})

const PROBE_CLASS = 'editor-virtualized-metric-probe'
const LAYER_CLASS = 'editor-virtualized-hidden-character-layer'
// Every way the markers reach the document: the layer into the row, the spans into the layer.
const LAYER_MUTATIONS = ['appendChild', 'insertBefore', 'remove', 'replaceChildren'] as const
const originalLayerMutations = new Map<string, PropertyDescriptor | undefined>()
const highlightsMap = new Map<string, Highlight>()
// Reading a probe is the layout the font measurement costs, so counting the reads is how a pass
// that was supposed to leave the font alone is caught having asked for it.
let probeReads = 0
const mockRegistry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {}

let container: HTMLElement
let views: VirtualizedTextView[] = []
let advanceOf: ((character: string) => number) | null = null
let originalGetBoundingClientRect: () => DOMRect

function stubProbeMeasurement(): void {
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    if (!this.classList.contains(PROBE_CLASS)) return originalGetBoundingClientRect.call(this)

    probeReads += 1
    renderPhases.events?.push('read')
    if (!advanceOf) return originalGetBoundingClientRect.call(this)

    let width = 0
    for (const character of this.textContent ?? '') width += advanceOf(character)
    return { ...originalGetBoundingClientRect.call(this), width } as DOMRect
  }
}

function touchesMarkerLayer(nodes: readonly unknown[]): boolean {
  return nodes.some((node) => node instanceof HTMLElement && node.classList.contains(LAYER_CLASS))
}

function stubLayerMutations(): void {
  for (const name of LAYER_MUTATIONS) {
    const original = HTMLElement.prototype[name] as (...args: unknown[]) => unknown
    originalLayerMutations.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      writable: true,
      value: function recordMutation(this: HTMLElement, ...args: unknown[]) {
        if (renderPhases.events && touchesMarkerLayer([this, ...args])) {
          renderPhases.events.push('write')
        }

        return original.apply(this, args)
      },
    })
  }
}

function restoreLayerMutations(): void {
  for (const [name, descriptor] of originalLayerMutations) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }

  originalLayerMutations.clear()
}

function phasesDuring(render: () => void): readonly ('read' | 'write')[] {
  const events: ('read' | 'write')[] = []
  renderPhases.events = events
  try {
    render()
  } finally {
    renderPhases.events = null
  }

  return events
}

function mountView(options: VirtualizedTextViewOptions, text: string): VirtualizedTextView {
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 0,
    highlightRegistry: mockRegistry,
    selectionHighlightName: 'test-selection',
    ...options,
  })
  views.push(view)
  view.setText(text)
  view.setScrollMetrics(0, 200)
  return view
}

function markers(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-hidden-character-marker')]
}

// Sorted, because recycled rows sit in the container in mount order rather than in document order.
function markerOffsets(): number[] {
  return markers()
    .map((marker) => Number(marker.dataset.editorHiddenCharacterOffset))
    .sort((left, right) => left - right)
}

function lookupsDuring(render: () => void): number {
  const before = geometry.lookups
  render()
  return geometry.lookups - before
}

function probeReadsDuring(render: () => void): number {
  const before = probeReads
  render()
  return probeReads - before
}

function glyphAsksDuring(render: () => void): number {
  const before = glyphAsks.count
  render()
  return glyphAsks.count - before
}

function markerLefts(): string[] {
  return markers().map((marker) => marker.style.left)
}

// The declaration blocks of every rule that styles a marker, selector stripped.
function markerStyleBodies(stylesheet: string): string[] {
  return [...stylesheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((rule) => rule[1]!.includes('hidden-character'))
    .map((rule) => rule[2]!)
}

describe('hidden character markers', () => {
  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    advanceOf = null
    probeReads = 0
    renderPhases.events = null
    stubProbeMeasurement()
    stubLayerMutations()
    clearBrowserTextMetricsCache()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    for (const view of views) view.dispose()
    views = []
    container.remove()
    renderPhases.events = null
    restoreLayerMutations()
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    clearBrowserTextMetricsCache()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('does not re-measure whitespace positions for a row nothing has changed', () => {
    const indented = `${' '.repeat(8)}const value = 1`
    const shown = mountView({ hiddenCharacters: 'show' }, '')
    const hidden = mountView({ hiddenCharacters: 'hidden' }, '')

    const firstShown = lookupsDuring(() => shown.setText(indented))
    const firstHidden = lookupsDuring(() => hidden.setText(indented))
    const settledShown = lookupsDuring(() => shown.setSelection(0, 0))
    const settledHidden = lookupsDuring(() => hidden.setSelection(0, 0))

    expect(firstShown).toBeGreaterThan(firstHidden)
    expect(settledShown).toBe(settledHidden)
  })

  // Where a column sits is a question about the settled layout, and every marker written into a row
  // unsettles it again, so a pass that alternates the two makes the browser settle once per row.
  it('measures every row before it draws into any of them', () => {
    const indented = Array.from({ length: 6 }, () => '  ab  cd').join('\n')
    const view = mountView({ hiddenCharacters: 'hidden' }, indented)

    const phases = phasesDuring(() => view.setHiddenCharacters('show'))

    expect(phases).toContain('read')
    expect(phases).toContain('write')
    expect(phases.lastIndexOf('read')).toBeLessThan(phases.indexOf('write'))
  })

  it('re-measures the row an edit moved', () => {
    const view = mountView({ hiddenCharacters: 'show' }, '  a  b')

    const edited = lookupsDuring(() => view.setText('    a  b'))

    expect(edited).toBeGreaterThan(0)
    expect(markerOffsets()).toEqual([0, 1, 2, 3, 5, 6])
  })

  it('marks a recycled row for the line it lands on, not the one it left', () => {
    const lines = Array.from({ length: 20 }, () => 'abcd').concat(
      Array.from({ length: 20 }, () => '  ab'),
    )
    const view = mountView({ hiddenCharacters: 'show' }, lines.join('\n'))

    const unmarked = markers().length
    view.setScrollMetrics(400, 200)

    expect(unmarked).toBe(0)
    expect(markers()).toHaveLength(20)
    expect(markerOffsets().slice(0, 2)).toEqual([100, 101])
  })

  it('marks indentation and runs but not lone word separators in boundary mode', () => {
    mountView({ hiddenCharacters: 'boundary' }, '  ab  cd e ')

    expect(markerOffsets()).toEqual([0, 1, 4, 5, 10])
  })

  it('marks tabs anywhere in boundary mode', () => {
    mountView({ hiddenCharacters: 'boundary' }, 'a\tb c')

    expect(markerOffsets()).toEqual([1])
  })

  it('marks only whitespace past the end of the text in trailing mode', () => {
    mountView({ hiddenCharacters: 'trailing' }, '  ab  cd  \n   ')

    expect(markerOffsets()).toEqual([8, 9, 11, 12, 13])
  })

  it('leaves a wrapped segment that carries on below unmarked in trailing mode', () => {
    const view = mountView(
      {
        hiddenCharacters: 'trailing',
        wrap: true,
        gutterContributions: [createLineGutterContribution()],
      },
      'ab   cd  ',
    )
    mockViewport(view.scrollElement, 72, 200)
    view.setScrollMetrics(0, 200, 72)

    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['ab   ', 'cd  '])
    expect(markerOffsets()).toEqual([7, 8])
  })

  it('draws the space dot the font sets closest to its own space width', () => {
    advanceOf = (character) => (character === '·' ? 20 : 8)
    mountView({ hiddenCharacters: 'show' }, 'a b\tc')

    expect(markers().map((marker) => marker.textContent)).toEqual(['⸱', '→'])
  })

  it('moves the markers a font change moved, on a row whose text is the same', () => {
    advanceOf = () => 8
    const view = mountView({ hiddenCharacters: 'show' }, 'ab cd')
    const beforeWiderFont = markerLefts()

    advanceOf = () => 16
    clearBrowserTextMetricsCache()
    view.refreshMetrics()

    expect(beforeWiderFont).toEqual(['16px'])
    expect(markerLefts()).toEqual(['32px'])
  })

  it('keeps the marker elements a re-measurement lands back on', () => {
    advanceOf = () => 8
    const view = mountView({ hiddenCharacters: 'show' }, 'ab cd')
    const before = markers()[0]

    clearBrowserTextMetricsCache()
    view.refreshMetrics()

    expect(markers()).toHaveLength(1)
    expect(markers()[0]).toBe(before)
  })

  // Every space on screen is drawn with the one glyph, so the font has an answer for the pass rather
  // than an answer for each marker, and asking again per marker re-enters the whole metric lookup.
  it('asks the font for the space glyph once however many spaces the pass marks', () => {
    const indented = Array.from({ length: 6 }, () => '  ab  cd').join('\n')
    const view = mountView({ hiddenCharacters: 'hidden' }, indented)

    const asks = glyphAsksDuring(() => view.setHiddenCharacters('show'))

    expect(markers().length).toBeGreaterThan(20)
    expect(asks).toBe(1)
  })

  it('leaves the font unread by a pass that rebuilds no row', () => {
    const shown = mountView({ hiddenCharacters: 'show' }, 'a b')
    const hidden = mountView({ hiddenCharacters: 'hidden' }, 'a b')
    clearBrowserTextMetricsCache()

    const settledShown = probeReadsDuring(() => shown.setSelection(0, 0))
    const settledHidden = probeReadsDuring(() => hidden.setSelection(0, 0))

    expect(settledShown).toBe(0)
    expect(settledHidden).toBe(0)
  })

  // One character swapped for another leaves the row's length and its start offset where they were,
  // so nothing but the revision separates the edited line from the one before it.
  it('marks a space an edit put where a letter of the same row was', () => {
    const view = mountView({ hiddenCharacters: 'show' }, 'ab\ncd')

    const unedited = markerOffsets()
    view.setText('ab\nc ')

    expect(unedited).toEqual([])
    expect(markerOffsets()).toEqual([4])
  })

  // Eight columns of scroll under a two-column viewport lands the third aligned window of a line
  // long enough to be split: the same text, the same revision, a different slice of it mounted.
  it('marks the whitespace in the chunk window a horizontal scroll mounted', () => {
    const long = `${'a'.repeat(8)}${' '.repeat(4)}${'b'.repeat(20)}`
    const view = mountView(
      {
        hiddenCharacters: 'show',
        longLineChunkSize: 4,
        longLineChunkThreshold: 8,
        horizontalOverscanColumns: 0,
      },
      long,
    )
    view.setScrollMetrics(0, 200, 16)

    const unscrolled = markerOffsets()
    view.setScrollMetrics(0, 200, 16, 64)

    expect(unscrolled).toEqual([])
    expect(markerOffsets()).toEqual([8, 9, 10, 11])
  })

  // Phantom text stands in for no source text at all, so every column of it answers with the one
  // buffer offset its point sits at — and a marker per column stacks them all on the same box.
  it('marks the row’s own space rather than the ones a replacement hung off it', () => {
    const text = 'abcde fghij'
    advanceOf = () => 8
    const view = mountView({ hiddenCharacters: 'show' }, text)
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        { id: 'ghost', startIndex: 5, endIndex: 5, text: ' hi ', insertion: true },
      ]),
    )

    expect(view.getState().mountedRows[0]?.text).toBe('abcde hi  fghij')
    expect(markerOffsets()).toEqual([5])
    expect(markerLefts()).toEqual(['72px'])
  })

  it('carries the glyph on the marker itself, with no second one from the stylesheet', () => {
    advanceOf = () => 8
    mountView({ hiddenCharacters: 'show' }, 'a b\tc')
    const stylesheet = readFileSync(`${import.meta.dirname}/../src/style.css`, 'utf8')

    expect(markers().map((marker) => marker.textContent)).toEqual(['·', '→'])
    expect(markerStyleBodies(stylesheet).filter((body) => body.includes('content'))).toEqual([])
  })
})

function mockViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}
