import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshotText } from './factories/snapshotText'

import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
} from '../src/plugins'
import {
  TEST_DOCUMENT_SYNC_POINT,
  unchangedChangesSinceDocumentSyncPoint,
} from './factories/documentSync'
import {
  createSemanticTokenLayer,
  SEMANTIC_TOKEN_Z_INDEX,
  type SemanticTokenLayerOptions,
} from '../src/semanticTokenLayer'
import { createSemanticTokenStyles, EditorTokenStore, type SemanticTokenSpan } from '../src/syntax'
import type { VirtualizedTextHighlightStyle } from '../src/virtualization'
import { createTestViewContributionContext } from '../src/testContexts'

const LINE_COUNT = 12
// Long enough that a test can lay out a hundred distinct spans without them clamping into each
// other at the end of the document, which is what the normalizer would otherwise do.
const TEXT = Array.from({ length: LINE_COUNT }, (_, row) => `const value${row} = ${row}`).join('\n')
const LINE_LENGTH = 'const value0 = 0'.length + 1

type PaintedGroup = {
  readonly ranges: readonly { readonly start: number; readonly end: number }[]
  readonly style: VirtualizedTextHighlightStyle
}

type Harness = {
  readonly layer: ReturnType<typeof createSemanticTokenLayer>
  readonly groups: Map<string, PaintedGroup>
  readonly requests: { start: number; end: number; documentId: string; textVersion: number }[]
  readonly resyncs: string[]
  setSnapshot(next: Partial<EditorViewSnapshot>): void
  /** The live object the context hands the layer, so a test can watch what the layer reads off it. */
  snapshot(): EditorViewSnapshot
  update(kind: Parameters<ReturnType<typeof createSemanticTokenLayer>['update']>[1]): void
}

function harness(options: Partial<SemanticTokenLayerOptions> = {}): Harness {
  const groups = new Map<string, PaintedGroup>()
  const requests: Harness['requests'] = []
  const resyncs: string[] = []
  let snapshot = baseSnapshot()

  const context: EditorViewContributionContext = createTestViewContributionContext({
    container: document.createElement('div'),
    scrollElement: document.createElement('div') as HTMLDivElement,
    contentElement: document.createElement('div'),
    highlightPrefix: 'test-',
    getSnapshot: () => snapshot,
    textOffsetFromPoint: vi.fn(() => 0),
    setRangeHighlight: (name, ranges, style) => {
      groups.set(name, { ranges: ranges.map((range) => ({ ...range })), style })
    },
    clearRangeHighlight: (name) => {
      groups.delete(name)
    },
  })

  const layer = createSemanticTokenLayer(context, {
    name: 'semantic',
    onRangeNeeded: (request) => requests.push({ ...request }),
    onResyncRequired: (reason) => resyncs.push(reason),
    ...options,
  })

  return {
    layer,
    groups,
    requests,
    resyncs,
    setSnapshot: (next) => {
      snapshot = { ...snapshot, ...next }
    },
    snapshot: () => snapshot,
    update: (kind) => layer.update(snapshot, kind),
  }
}

function baseSnapshot(): EditorViewSnapshot {
  return {
    changesSinceDocumentSyncPoint: unchangedChangesSinceDocumentSyncPoint,
    documentId: 'src/index.ts',
    documentSyncPoint: TEST_DOCUMENT_SYNC_POINT,
    languageId: 'typescript',
    ...snapshotText(TEXT),
    textVersion: 7,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    lineStarts: Array.from({ length: LINE_COUNT }, (_, row) => row * LINE_LENGTH),
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: LINE_COUNT,
    contentWidth: 0,
    totalHeight: 0,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: visibleRows(0, 2),
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      visibleRange: { start: 0, end: LINE_COUNT } as EditorViewSnapshot['viewport']['visibleRange'],
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

function visibleRows(from: number, to: number): readonly EditorVisibleRowSnapshot[] {
  const rows: EditorVisibleRowSnapshot[] = []
  for (let row = from; row <= to; row += 1) {
    rows.push({
      index: row,
      bufferRow: row,
      source: 'text' as EditorVisibleRowSnapshot['source'],
      startOffset: row * LINE_LENGTH,
      endOffset: row * LINE_LENGTH + LINE_LENGTH - 1,
      text: '',
      kind: 'text',
      primaryText: true,
      firstWrapSegment: true,
      top: row * 20,
      height: 20,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    })
  }
  return rows
}

const span = (
  start: number,
  end: number,
  tokenType: string,
  tokenModifiers?: readonly string[],
): SemanticTokenSpan => ({ end, start, tokenModifiers, tokenType })

const payload = (spans: readonly SemanticTokenSpan[], overrides: Record<string, unknown> = {}) => ({
  documentId: 'src/index.ts',
  textVersion: 7,
  spans,
  ...overrides,
})

describe('painting', () => {
  /**
   * The cost driver is the live group count, and the group count is the number of distinct resolved
   * *styles* the viewport holds — not the number of spans, and not the size of the server's legend.
   * That is what makes an unread fifty-type legend safe to receive.
   */
  it('makes one group per distinct resolved style, not one per span', () => {
    const test = harness()
    const names = ['variable', 'keyword', 'string']
    const spans = Array.from({ length: 60 }, (_, index) =>
      span(index * 3, index * 3 + 2, names[index % names.length] as string),
    )

    const result = test.layer.push(payload(spans))

    expect(result.status === 'painted' && result.paintedSpans).toBe(60)
    expect(test.groups.size).toBe(3)
  })

  it('collapses a legend the host aliased onto fewer scopes', () => {
    // The shape of a real registry entry: a legend of forty names, most of them the server's own,
    // mapped by the host onto three the theme knows.
    const custom = Array.from({ length: 40 }, (_, index) => `serverType${index}`)
    const scopeAliases = Object.fromEntries(
      custom.map((name, index) => [name, ['variable', 'keyword', 'string'][index % 3] as string]),
    )
    const test = harness({ scopeAliases })

    test.layer.push(payload(custom.map((name, index) => span(index * 4, index * 4 + 2, name))))

    expect(test.groups.size).toBe(3)
  })

  /**
   * The bound with no aliases at all is the *vocabulary*, because every standard token type is
   * registered as a colour id of its own so a theme can set each one — twenty-three ids, not a
   * handful, and never more however large the legend is. `resolve` is the same function the layer
   * uses, so this cannot drift from what actually paints.
   */
  it('is bounded by the vocabulary rather than by the legend', () => {
    const test = harness()
    const names = [
      'class',
      'enum',
      'interface',
      'struct',
      'type',
      'namespace',
      'variable',
      'property',
      'parameter',
      'function',
      'method',
      'macro',
      'event',
      'keyword',
      'modifier',
      'string',
      'regexp',
      'number',
      'comment',
      'operator',
    ]
    const styles = createSemanticTokenStyles({ zIndex: SEMANTIC_TOKEN_Z_INDEX })
    const distinctStyles = new Set(names.map((name) => JSON.stringify(styles.resolve(name))))

    test.layer.push(payload(names.map((name, index) => span(index * 5, index * 5 + 3, name))))

    expect(test.groups.size).toBe(distinctStyles.size)
    expect(test.groups.size).toBeLessThanOrEqual(23)
  })

  it('namespaces its groups with the view prefix', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))

    expect([...test.groups.keys()]).toEqual(['test-semantic-0'])
  })

  it('stacks in the semantic band', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))

    expect([...test.groups.values()][0]?.style.zIndex).toBe(SEMANTIC_TOKEN_Z_INDEX)
  })

  it('sorts, clamps and drops zero-length spans the host did not have to', () => {
    const test = harness()
    test.layer.push(
      payload([
        span(20, 25, 'keyword'),
        span(9, 9, 'keyword'),
        span(0, 5, 'keyword'),
        span(TEXT.length - 2, TEXT.length + 400, 'keyword'),
      ]),
    )

    expect([...test.groups.values()][0]?.ranges).toEqual([
      { start: 0, end: 5 },
      { start: 20, end: 25 },
      { start: TEXT.length - 2, end: TEXT.length },
    ])
  })

  /**
   * `overlappingTokenSupport` defaults to false and this editor does not honour it, which is why the
   * capability builder cannot declare it. Where two spans overlap the later one by start wins.
   */
  it('truncates an overlapping span rather than layering it', () => {
    const test = harness()
    test.layer.push(payload([span(0, 10, 'keyword'), span(6, 12, 'keyword')]))

    const ranges = [...test.groups.values()][0]?.ranges ?? []
    expect(ranges).toEqual([
      { start: 0, end: 6 },
      { start: 6, end: 12 },
    ])
    expect(ranges.every((range) => range.end > range.start)).toBe(true)
  })

  /** Two that begin together: the shorter is the more specific, and the longer keeps its tail. */
  it('keeps the tail of the longer span when two begin together', () => {
    const test = harness()
    test.layer.push(payload([span(4, 10, 'keyword'), span(4, 12, 'keyword')]))

    expect([...test.groups.values()][0]?.ranges).toEqual([
      { start: 4, end: 10 },
      { start: 10, end: 12 },
    ])
  })

  /**
   * The case a single-element lookback lost. Popping the container and keeping only its head threw
   * away everything after the nested span — a server that marks one interpolation inside a template
   * literal used to lose the rest of the literal's colour, with `paintedSpans` reporting a clean
   * paint. Every character either span described is still described by one of them.
   */
  it('splits a containing span around a nested one rather than dropping its tail', () => {
    const test = harness()
    const result = test.layer.push(payload([span(0, 10, 'string'), span(4, 6, 'variable')]))

    const painted = [...test.groups.values()]
      .flatMap((group) => group.ranges)
      .sort((left, right) => left.start - right.start)
    expect(painted).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 6 },
      { start: 6, end: 10 },
    ])
    // Two colours, not one: the container is still a string on both sides of the hole.
    expect(test.groups.size).toBe(2)
    expect([...test.groups.values()].find((group) => group.ranges.length === 2)?.ranges).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ])
    expect(result.status === 'painted' && result.paintedSpans).toBe(3)
  })

  /** Three deep, which is where a lookback that only ever inspects the last resolved span gives up. */
  it('resolves nesting deeper than one level without losing a character', () => {
    const test = harness()
    test.layer.push(
      payload([span(0, 20, 'string'), span(4, 16, 'keyword'), span(8, 12, 'variable')]),
    )

    const painted = [...test.groups.values()]
      .flatMap((group) => group.ranges)
      .sort((left, right) => left.start - right.start)
    expect(painted).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
      { start: 12, end: 16 },
      { start: 16, end: 20 },
    ])
  })

  // A source that can report only its length proves a push reads no text.
  it('reads the document length without reading the document', () => {
    const test = harness()
    test.setSnapshot({
      textSnapshot: { length: TEXT.length } as EditorViewSnapshot['textSnapshot'],
    })

    const result = test.layer.push(payload([span(0, 5, 'keyword')]))

    expect(result.status).toBe('painted')
  })

  /**
   * The fall-through the contract depends on: an unresolved name paints nothing and the syntactic
   * layer shows through. It is also indistinguishable from success by eye, which is why the name is
   * reported rather than merely dropped.
   */
  it('reports an unresolved type name once, however many spans carried it', () => {
    const test = harness()
    const result = test.layer.push(
      payload([
        span(0, 5, 'zigBuiltin'),
        span(6, 9, 'zigBuiltin'),
        span(10, 12, 'typstLabel'),
        span(13, 14, 'keyword'),
      ]),
    )

    expect(result.status === 'painted' && result.unresolvedTypeNames).toEqual([
      'zigBuiltin',
      'typstLabel',
    ])
    expect(result.status === 'painted' && result.paintedSpans).toBe(1)
  })

  it('paints a custom name once the host supplies an alias for it', () => {
    const aliased = harness({ scopeAliases: { zigBuiltin: 'macro' } })
    const result = aliased.layer.push(payload([span(0, 5, 'zigBuiltin')]))

    expect(result.status === 'painted' && result.unresolvedTypeNames).toEqual([])
    expect([...aliased.groups.values()][0]?.style.color).toBe(
      createSemanticTokenStyles().resolve('macro')?.color,
    )
  })

  it('clears a group whose ranges are all gone on the next push', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword'), span(6, 11, 'string')]))
    expect(test.groups.size).toBe(2)

    test.layer.push(payload([span(0, 5, 'keyword')]))
    expect(test.groups.size).toBe(1)
  })

  it('keeps a group name stable for a style that comes and goes', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword'), span(6, 11, 'string')]))
    const stringGroup = [...test.groups.entries()].find(
      ([, group]) => group.style.color === createSemanticTokenStyles().resolve('string')?.color,
    )?.[0]

    test.layer.push(payload([span(0, 5, 'keyword')]))
    test.layer.push(payload([span(0, 5, 'keyword'), span(6, 11, 'string')]))

    expect(test.groups.has(stringGroup ?? '')).toBe(true)
  })

  it('paints a span that crosses a newline as one range', () => {
    const test = harness()
    test.layer.push(payload([span(6, LINE_LENGTH + 5, 'variable')]))

    expect([...test.groups.values()][0]?.ranges).toEqual([{ start: 6, end: LINE_LENGTH + 5 }])
    expect(TEXT.slice(6, LINE_LENGTH + 5)).toContain('\n')
  })

  it('empties every group on clear, and keeps them on a drop', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))

    test.layer.push(payload([span(0, 5, 'keyword')], { documentId: 'src/other.ts' }))
    expect(test.groups.size).toBe(1)

    test.layer.clear()
    expect(test.groups.size).toBe(0)
  })
})

describe('a layer that outlives its document', () => {
  /**
   * A layer never spans two documents. The plugin enforces that by disposing this one and handing
   * the host a new one, but `createSemanticTokenLayer` is public — and a caller holding one layer
   * across a document switch would otherwise keep the previous file's spans painted *and* keep
   * re-anchoring them, because a tracked range built against one buffer resolves against another to
   * a live offset rather than to nothing. `push()` cannot see that happen; only `update()` can.
   */
  it('drops what it painted when the document underneath it changes', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))
    expect(test.groups.size).toBe(1)

    test.setSnapshot({ documentId: 'src/other.ts' })
    test.update('document')

    expect(test.groups.size).toBe(0)
  })

  it('keeps painting while the document stays the same', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))

    test.update('document')
    test.update('content')
    test.update('viewport')

    expect(test.groups.size).toBe(1)
  })

  it('paints the new document once it is pushed for', () => {
    const test = harness()
    test.layer.push(payload([span(0, 5, 'keyword')]))
    test.setSnapshot({ documentId: 'src/other.ts' })
    test.update('document')

    const result = test.layer.push(payload([span(0, 5, 'string')], { documentId: 'src/other.ts' }))

    expect(result.status).toBe('painted')
    expect(test.groups.size).toBe(1)
  })
})

describe('the version and document check', () => {
  it('paints a payload stamped with the current version', () => {
    const test = harness()
    const result = test.layer.push(payload([span(0, 5, 'keyword')]))

    expect(result).toEqual({
      paintedSpans: 1,
      projectedThroughEdits: 0,
      status: 'painted',
      unresolvedTypeNames: [],
    })
  })

  /**
   * Not an edge case. With pooled backends and a shared root, a response arriving after the user
   * switched documents is an ordinary path — and a payload that could not name its document would
   * paint the previous file's spans onto this one.
   */
  it('drops a payload for a document that is not the active one', () => {
    const test = harness()
    const result = test.layer.push(payload([span(0, 5, 'keyword')], { documentId: 'src/other.ts' }))

    expect(result).toEqual({ reason: 'document-changed', status: 'dropped' })
    expect(test.groups.size).toBe(0)
    expect(test.resyncs).toEqual(['document-changed'])
  })

  it('drops a payload stamped ahead of the editor', () => {
    const test = harness()
    const result = test.layer.push(payload([span(0, 5, 'keyword')], { textVersion: 9 }))

    expect(result).toEqual({ reason: 'version-ahead', status: 'dropped' })
    expect(test.resyncs).toEqual(['version-ahead'])
  })
})

describe('the demand signal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the visible offset range, with no uri on it', () => {
    const test = harness()
    test.update('viewport')

    expect(test.requests).toEqual([
      {
        documentId: 'src/index.ts',
        textVersion: 7,
        start: 0,
        end: LINE_LENGTH * 2 + LINE_LENGTH - 1,
      },
    ])
    expect(test.requests[0] && 'uri' in test.requests[0]).toBe(false)
  })

  it('adds no delay of its own when the host asked for none', () => {
    const test = harness()
    test.update('viewport')
    test.setSnapshot({ visibleRows: visibleRows(1, 2) })
    test.update('viewport')

    expect(test.requests).toHaveLength(2)
  })

  it('says nothing when neither the viewport nor the text moved', () => {
    const test = harness()
    test.update('viewport')
    test.update('viewport')
    test.update('selection')
    test.update('layout')

    expect(test.requests).toHaveLength(1)
  })

  /**
   * `'viewport'` is fired once per scroll event and is not throttled at source, so a flung scroll is
   * one update per frame. The delay is the host's number; what the editor guarantees is that
   * everything inside the window coalesces into one call.
   */
  it('coalesces a flung scroll into one call when the host supplies a delay', () => {
    const test = harness({ viewportDelayMs: 120 })
    for (let step = 0; step < 20; step += 1) {
      test.setSnapshot({ visibleRows: visibleRows(step % 3, 2) })
      test.update('viewport')
    }
    expect(test.requests).toHaveLength(0)

    vi.advanceTimersByTime(120)
    expect(test.requests).toHaveLength(1)
  })

  it('asks again when the text under an unmoved viewport changed', () => {
    const test = harness()
    test.update('viewport')
    test.setSnapshot({ textVersion: 8 })
    test.update('content')

    expect(test.requests.map((request) => request.textVersion)).toEqual([7, 8])
  })

  it('stops asking once disposed, and drops what it painted', () => {
    const test = harness({ viewportDelayMs: 50 })
    test.layer.push(payload([span(0, 5, 'keyword')]))
    test.update('viewport')

    test.layer.dispose()
    vi.advanceTimersByTime(500)

    expect(test.requests).toHaveLength(0)
    expect(test.groups.size).toBe(0)
  })
})
