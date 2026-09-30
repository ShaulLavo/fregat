/**
 * happy-dom ships no CSS Custom Highlight API, and that is the API the editor paints syntax tokens
 * and range highlights with — so without this a `document`-mode diff renders its text and silently
 * paints nothing, which is indistinguishable from the §C2 failure the M0 gate exists to rule out.
 *
 * The polyfill records ranges rather than rendering them, which is what the assertions read.
 */
export class TestHighlight {
  readonly ranges = new Set<AbstractRange>()

  constructor(...ranges: AbstractRange[]) {
    for (const range of ranges) this.ranges.add(range)
  }

  add(range: AbstractRange): this {
    this.ranges.add(range)
    return this
  }

  clear(): void {
    this.ranges.clear()
  }

  delete(range: AbstractRange): boolean {
    return this.ranges.delete(range)
  }

  get size(): number {
    return this.ranges.size
  }

  [Symbol.iterator](): Iterator<AbstractRange> {
    return this.ranges[Symbol.iterator]()
  }
}

type HighlightGlobals = {
  Highlight?: unknown
  CSS?: { highlights?: Map<string, TestHighlight> }
}

export function installHighlightPolyfill(): void {
  const scope = globalThis as unknown as HighlightGlobals
  scope.Highlight ??= TestHighlight
  // happy-dom exposes `CSS` as a namespace whose members are non-writable, so plain assignment
  // silently does nothing; define the property instead.
  const css = scope.CSS ?? {}
  if (!css.highlights) {
    Object.defineProperty(css, 'highlights', {
      configurable: true,
      value: new Map<string, TestHighlight>(),
      writable: true,
    })
  }
  if (scope.CSS !== css) {
    Object.defineProperty(scope, 'CSS', { configurable: true, value: css, writable: true })
  }
}

export function highlightRegistry(): Map<string, TestHighlight> {
  const css = (globalThis as unknown as HighlightGlobals).CSS
  if (!css?.highlights) throw new Error('Highlight polyfill is not installed')
  return css.highlights
}

/** Every range currently registered anywhere in the document-global highlight registry. */
function registeredHighlightRanges(): readonly AbstractRange[] {
  return [...highlightRegistry().values()].flatMap((highlight) => [...highlight.ranges])
}

/** Registered ranges whose text sits inside `element`, i.e. what actually paints over that row. */
export function highlightRangesWithin(element: Element): readonly AbstractRange[] {
  return registeredHighlightRanges().filter((range) => element.contains(rangeNode(range)))
}

function rangeNode(range: AbstractRange): Node | null {
  const container = range.startContainer
  return container.nodeType === container.TEXT_NODE ? container.parentNode : container
}
