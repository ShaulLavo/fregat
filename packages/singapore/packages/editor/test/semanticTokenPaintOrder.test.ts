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
  type SemanticTokenLayer,
} from '../src/semanticTokenLayer'
import {
  createSemanticTokenStyles,
  EditorTokenStore,
  treeSitterCapturesToEditorTokens,
} from '../src/syntax'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'
import { createTestViewContributionContext } from '../src/testContexts'

/**
 * The semantic layer over a real mounted view, in the harness the house already uses for "which
 * highlight wins" — `::highlight()` styles are not reachable through `getComputedStyle`, so paint
 * order is asserted against a Map-backed registry and a `Highlight` stand-in that carries a
 * priority, exactly as `rangeDecorationPaintOrder.test.ts` does.
 */
class MockHighlight extends Set<Range> {
  priority = 0
}

const ROW_HEIGHT = 20
const TEXT = ['const MAX = 10', 'const other = MAX', 'const third = 3'].join('\n')
const LINE_LENGTH = 'const MAX = 10'.length + 1
const MAX_START = TEXT.indexOf('MAX')
const MAX_END = MAX_START + 'MAX'.length

const highlights = new Map<string, Highlight>()
const registry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlights.set(name, highlight)
  },
  delete: (name) => highlights.delete(name),
}

type Mounted = {
  readonly view: VirtualizedTextView
  readonly layer: SemanticTokenLayer
  dispose(): void
}

function mounted(): Mounted {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const view = new VirtualizedTextView(container, {
    highlightRegistry: registry,
    overscan: 0,
    rowHeight: ROW_HEIGHT,
  })
  view.setText(TEXT)
  view.setScrollMetrics(0, ROW_HEIGHT * 4)
  // The syntactic layer as the worker produces it: `MAX` is the constant, and every other token
  // sits at the default highlight priority alongside it.
  view.setTokens(
    treeSitterCapturesToEditorTokens([
      { captureName: 'keyword.declaration', endIndex: 5, startIndex: 0 },
      { captureName: 'constant', endIndex: MAX_END, startIndex: MAX_START },
      { captureName: 'number', endIndex: 14, startIndex: 12 },
    ]),
  )

  const context = viewContext(view, container)
  const layer = createSemanticTokenLayer(context, { name: 'semantic' })

  return {
    view,
    layer,
    dispose: () => {
      layer.dispose()
      view.dispose()
      container.remove()
    },
  }
}

function viewContext(
  view: VirtualizedTextView,
  container: HTMLElement,
): EditorViewContributionContext {
  return createTestViewContributionContext({
    container,
    scrollElement: container as HTMLDivElement,
    contentElement: view.contentElement,
    highlightPrefix: 'test-',
    getSnapshot: () => snapshot(),
    textOffsetFromPoint: vi.fn(() => 0),
    setRangeHighlight: (name, ranges, style) => view.setRangeHighlight(name, ranges, style),
    clearRangeHighlight: (name) => view.clearRangeHighlight(name),
  })
}

function snapshot(): EditorViewSnapshot {
  const rows: EditorVisibleRowSnapshot[] = [0, 1, 2].map((row) => ({
    index: row,
    bufferRow: row,
    source: 'text' as EditorVisibleRowSnapshot['source'],
    startOffset: row * LINE_LENGTH,
    endOffset: row * LINE_LENGTH + LINE_LENGTH - 1,
    text: '',
    kind: 'text' as const,
    primaryText: true,
    firstWrapSegment: true,
    top: row * ROW_HEIGHT,
    height: ROW_HEIGHT,
    leftSpacerWidth: 0,
    contentCursorLine: false,
    gutterNumberCursorLine: false,
    gutterCursorLineBackgroundLaneIds: [],
    mountedPaintSupport: 'replayable',
    chunks: [],
    foldMarker: null,
  }))

  return {
    changesSinceDocumentSyncPoint: unchangedChangesSinceDocumentSyncPoint,
    documentId: 'src/index.ts',
    documentSyncPoint: TEST_DOCUMENT_SYNC_POINT,
    languageId: 'typescript',
    ...snapshotText(TEXT),
    textVersion: 1,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    lineStarts: [0, LINE_LENGTH, LINE_LENGTH * 2],
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: 3,
    contentWidth: 0,
    totalHeight: 0,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: rows,
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      visibleRange: { start: 0, end: 3 } as EditorViewSnapshot['viewport']['visibleRange'],
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

function rulesByName(): Map<string, string> {
  const rules = new Map<string, string>()
  for (const style of document.head.querySelectorAll('style')) {
    for (const match of (style.textContent ?? '').matchAll(/::highlight\((.+?)\)\s*\{(.*?)\}/g)) {
      rules.set(match[1] ?? '', (match[2] ?? '').trim())
    }
  }
  return rules
}

function coveringMax(): { name: string; priority: number; rule: string }[] {
  const rules = rulesByName()
  const found: { name: string; priority: number; rule: string }[] = []
  for (const [name, highlight] of highlights) {
    for (const range of highlight as unknown as Set<Range>) {
      if (range.startOffset !== MAX_START || range.endOffset !== MAX_END) continue

      found.push({ name, priority: highlight.priority, rule: rules.get(name) ?? '' })
      break
    }
  }
  return found
}

describe('semantic colour over the syntactic layer', () => {
  let test: Mounted

  beforeEach(() => {
    highlights.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    test = mounted()
  })

  afterEach(() => {
    test.dispose()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('registers both highlights over the same identifier, semantic above syntactic', () => {
    test.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [
        { start: MAX_START, end: MAX_END, tokenType: 'variable', tokenModifiers: ['readonly'] },
      ],
    })

    const covering = coveringMax()
    expect(covering).toHaveLength(2)

    const semantic = covering.find((entry) => entry.name.startsWith('test-semantic'))
    const token = covering.find((entry) => !entry.name.startsWith('test-semantic'))
    expect(semantic?.priority).toBe(SEMANTIC_TOKEN_Z_INDEX)
    expect(token?.priority).toBe(0)
    // Priority only decides between highlights that declare the same property, so the contest is
    // real only because both of these declare a colour.
    expect(semantic?.rule).toContain('color:')
    expect(token?.rule).toContain('color:')
  })

  it('leaves only the syntactic group once the layer is cleared', () => {
    test.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [{ start: MAX_START, end: MAX_END, tokenType: 'variable' }],
    })
    expect(coveringMax()).toHaveLength(2)

    test.layer.clear()

    const remaining = coveringMax()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.name.startsWith('test-semantic')).toBe(false)
  })

  it('paints nothing for a name the theme does not claim, leaving the token colour alone', () => {
    const before = coveringMax()
    const result = test.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [{ start: MAX_START, end: MAX_END, tokenType: 'zigBuiltinCall' }],
    })

    expect(result.status === 'painted' && result.unresolvedTypeNames).toEqual(['zigBuiltinCall'])
    expect(coveringMax()).toEqual(before)
  })

  /**
   * The criterion that gates the host declaring `multilineTokenSupport`. Until it passes, the
   * capability builder refuses the flag and a conformant server sends no multi-line token — so this
   * is the assertion that opens it, not a nicety.
   */
  it('paints a span crossing a newline across two mounted rows', () => {
    const start = TEXT.indexOf('10')
    const end = TEXT.indexOf('other') + 'other'.length

    test.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [{ start, end, tokenType: 'string' }],
    })

    const semanticName = [...highlights.keys()].find((name) => name.startsWith('test-semantic'))
    const ranges = [...(highlights.get(semanticName ?? '') as unknown as Set<Range>)]

    expect(TEXT.slice(start, end)).toContain('\n')
    // One DOM range per mounted row the span passes through: the rows are separate elements, so a
    // single range could not span both.
    expect(ranges).toHaveLength(2)
    expect(new Set(ranges.map((range) => range.startContainer)).size).toBe(2)
  })

  it('paints one group for many spans that share a colour', () => {
    test.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [
        { start: 0, end: 5, tokenType: 'keyword' },
        { start: LINE_LENGTH, end: LINE_LENGTH + 5, tokenType: 'keyword' },
        { start: LINE_LENGTH * 2, end: LINE_LENGTH * 2 + 5, tokenType: 'keyword' },
      ],
    })

    const semantic = [...highlights.keys()].filter((name) => name.startsWith('test-semantic'))
    expect(semantic).toHaveLength(1)
    expect(rulesByName().get(semantic[0] ?? '')).toBe(
      `color: ${createSemanticTokenStyles().resolve('keyword')?.color};`,
    )
  })
})
