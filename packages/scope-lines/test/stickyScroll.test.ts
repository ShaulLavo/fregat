import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { Editor } from '@singapore-editor/core/editor'
import { VirtualizedTextView } from '@singapore-editor/core/testing'
import type { VirtualizedFoldMarker } from '@singapore-editor/core/rendering'
import { EditorTokenStore, type EditorToken } from '@singapore-editor/core/syntax'
import type {
  EditorPluginContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
} from '@singapore-editor/core/extensions'
import {
  createTestPluginContext,
  createTestViewContributionContext,
  resetEditorInstanceCount,
  setHighlightRegistry,
} from '@singapore-editor/core/testing'
import { createStickyScrollPlugin } from '../src/stickyScroll'

const LINES = [
  'function outer() {',
  '  const a = 1',
  '  if (a) {',
  '    inner()',
  '    more()',
  '  }',
  '}',
  'tail()',
]
const TEXT = LINES.join('\n')
const ROW_HEIGHT = 20

class MockHighlight extends Set<Range> {}

beforeAll(() => {
  // @ts-expect-error happy-dom does not provide Highlight.
  globalThis.Highlight = MockHighlight
})

beforeEach(() => {
  document.body.replaceChildren()
})

describe('createStickyScrollPlugin', () => {
  it('registers a view contribution factory', () => {
    const registerViewContribution = vi.fn<EditorPluginContext['registerViewContribution']>(() => ({
      dispose: vi.fn(),
    }))
    const plugin = createStickyScrollPlugin()

    const disposable = plugin.activate(createPluginContext(registerViewContribution))

    expect(plugin.name).toBe('sticky-scroll')
    expect(disposable).toBeDefined()
    expect(registerViewContribution).toHaveBeenCalledOnce()
  })

  it('returns no contribution when disabled', () => {
    const registration = registeredProvider(createStickyScrollPlugin({ enabled: false }))

    expect(registration?.createContribution(context())).toBeNull()
  })

  it('mirrors the enclosing scope headers as editor rows once their lines scroll away', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(scrolledSnapshot(60))

    const contribution = registration?.createContribution(testContext)

    expect(stickyRoot(testContext)?.hidden).toBe(false)
    expect(mirroredLines(testContext)).toEqual(['function outer() {', '  if (a) {'])
    expect(stickyLineView(testContext)?.style.height).toBe('40px')

    contribution?.dispose()
    expect(stickyRoot(testContext)).toBeNull()
  })

  it('spans the innermost scope it heads, which is what pushes the stack out as that scope ends', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(scrolledSnapshot(60))

    registration?.createContribution(testContext)

    // Rows 0-4: from the outermost header row down to the last row of the innermost scope, so the
    // 40px stack starts sliding out once less than 40px of that scope is left on screen.
    expect(stickyRoot(testContext)?.style.top).toBe('0px')
    expect(stickyRoot(testContext)?.style.height).toBe('100px')
  })

  it('follows the scope chain out as the inner scopes end', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(scrolledSnapshot(60))
    const contribution = registration?.createContribution(testContext)

    contribution?.update(scrolledSnapshot(100), 'viewport')

    // The inner scope is behind us, so only the outer header is left and the stack now travels with
    // the outer scope's own end instead.
    expect(mirroredLines(testContext)).toEqual(['function outer() {'])
    expect(stickyLineView(testContext)?.style.height).toBe('20px')
    expect(stickyRoot(testContext)?.style.top).toBe('0px')
    expect(stickyRoot(testContext)?.style.height).toBe('120px')
  })

  it('renders nothing while the scope headers are still on screen', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(snapshot())

    registration?.createContribution(testContext)

    expect(stickyRoot(testContext)?.hidden).toBe(true)
    expect(stickyLineView(testContext)).toBeNull()
  })

  /**
   * Two scopes opening on one row is everyday code — `useMemo(() => ({...}), [user])` is an arrow
   * function and an object literal both starting on the row of the `const` — and the stack holds one
   * row for it, not one per scope, at the moment the row leaves and not a row earlier.
   */
  it('holds one slot for two scopes that open on the same row', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context({ ...scrolledSnapshot(60), foldMarkers: sameRowFoldMarkers() })

    registration?.createContribution(testContext)

    expect(mirroredLines(testContext)).toEqual(['function outer() {', '  if (a) {'])
    expect(stickyLineView(testContext)?.style.height).toBe('40px')
  })

  it('renders nothing for those two while their row is still on screen', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context({ ...snapshot(), foldMarkers: sameRowFoldMarkers() })

    registration?.createContribution(testContext)

    expect(stickyRoot(testContext)?.hidden).toBe(true)
  })

  it('leaves out a scope hidden inside a collapsed fold', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const [outer, inner] = foldMarkers()
    const testContext = context({
      ...scrolledSnapshot(60),
      foldMarkers: [{ ...outer!, collapsed: true }, inner!],
    })

    registration?.createContribution(testContext)

    expect(stickyRoot(testContext)?.hidden).toBe(true)
  })

  it('stops at the configured line count', () => {
    const registration = registeredProvider(createStickyScrollPlugin({ maxLineCount: 1 }))
    const testContext = context(scrolledSnapshot(60))

    registration?.createContribution(testContext)

    expect(mirroredLines(testContext)).toEqual(['function outer() {'])
    expect(stickyLineView(testContext)?.style.height).toBe('20px')
  })

  // A line count the stack cannot stop at is a stack that never stops, which covers the viewport.
  it('keeps one line for a line count below one, and a whole line for a fractional one', () => {
    for (const maxLineCount of [0, -3, 1.5]) {
      const registration = registeredProvider(createStickyScrollPlugin({ maxLineCount }))
      const testContext = context(scrolledSnapshot(60))

      registration?.createContribution(testContext)

      expect(mirroredLines(testContext), `maxLineCount ${maxLineCount}`).toEqual([
        'function outer() {',
      ])
      expect(stickyLineView(testContext)?.style.height).toBe('20px')
    }
  })

  it('shows the outermost scopes up to the default line count when the nesting runs deeper', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(deepSnapshot())

    registration?.createContribution(testContext)

    expect(mirroredLines(testContext)).toEqual(DEEP_LINES.slice(0, 5))
    expect(stickyLineView(testContext)?.style.height).toBe('100px')
  })

  it('shows those same five lines for a line count that is not a number', () => {
    const registration = registeredProvider(createStickyScrollPlugin({ maxLineCount: Number.NaN }))
    const testContext = context(deepSnapshot())

    registration?.createContribution(testContext)

    expect(mirroredLines(testContext)).toEqual(DEEP_LINES.slice(0, 5))
  })

  it('re-renders for the viewport and does not ask for caret moves', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context(scrolledSnapshot(60))
    const contribution = registration?.createContribution(testContext)

    expect(contribution?.inputs).not.toContain('selection')
    expect(mirroredLines(testContext)).toEqual(['function outer() {', '  if (a) {'])

    contribution?.update(scrolledSnapshot(100), 'viewport')

    expect(mirroredLines(testContext)).toEqual(['function outer() {'])
  })

  it('uses the text viewport without subtracting the minimap lane again', () => {
    const registration = registeredProvider(createStickyScrollPlugin())
    const viewSnapshot = scrolledSnapshot(60)
    const testContext = context({
      ...viewSnapshot,
      viewport: { ...viewSnapshot.viewport, scrollWidth: 372 },
    })
    const reservedWidth = vi.fn(() => 44)
    testContext.getReservedOverlayWidth = reservedWidth

    const contribution = registration?.createContribution(testContext)

    const root = stickyRoot(testContext)
    expect(root?.parentElement).toBe(testContext.contentElement)
    expect(root?.style.getPropertyValue('--editor-sticky-scroll-viewport-width')).toBe('320px')
    expect(root?.style.getPropertyValue('--editor-sticky-scroll-content-width')).toBe('372px')
    expect(reservedWidth).not.toHaveBeenCalled()

    contribution?.update(
      { ...viewSnapshot, viewport: { ...viewSnapshot.viewport, scrollWidth: 412 } },
      'viewport',
    )

    expect(root?.style.getPropertyValue('--editor-sticky-scroll-content-width')).toBe('412px')

    contribution?.update(
      {
        ...viewSnapshot,
        viewport: { ...viewSnapshot.viewport, clientWidth: 240, scrollWidth: 412 },
      },
      'viewport',
    )
    expect(root?.style.getPropertyValue('--editor-sticky-scroll-viewport-width')).toBe('240px')
    expect(reservedWidth).not.toHaveBeenCalled()
    contribution?.dispose()
  })

  it('carries the tokens of the rows it mirrors, rewritten into the stack', () => {
    const setTokens = vi.spyOn(VirtualizedTextView.prototype, 'setTokens')
    const registration = registeredProvider(createStickyScrollPlugin())
    const testContext = context({
      ...scrolledSnapshot(60),
      tokens: EditorTokenStore.fromTokens(tokens()),
    })

    registration?.createContribution(testContext)

    // 'function' keeps its offsets; 'if' moves to the second line of the stack; 'inner' is on a row
    // the stack does not show at all.
    expect(setTokens.mock.lastCall?.[0]).toEqual([
      { start: 0, end: 8, style: { color: 'keyword' } },
      { start: 21, end: 23, style: { color: 'control' } },
    ])
    setTokens.mockRestore()
  })
})

/**
 * The document a mounted editor is scrolled through below. Its indentation gives an unparsed file
 * two nested regions: the function, and the `if` whose last row is the last `step()` call.
 */
const MOUNTED_BODY_ROWS = 30
const MOUNTED_LINES = [
  'function outer() {',
  '  const a = 1',
  '  if (a) {',
  ...Array.from({ length: MOUNTED_BODY_ROWS }, (_, index) => `    step(${index})`),
  '  }',
  '  tail()',
  '}',
  ...Array.from({ length: 20 }, (_, index) => `after(${index})`),
]
/** Last row of the inner region, and so the row the stack is pinned until. */
const MOUNTED_INNER_END_ROW = 2 + MOUNTED_BODY_ROWS

describe('sticky scroll in a mounted editor', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    setHighlightRegistry({
      set: (name, highlight) => {
        highlightRegistry.set(name, highlight)
      },
      delete: (name) => highlightRegistry.delete(name),
    })
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { plugins: [createStickyScrollPlugin()] })
    const view: unknown = Reflect.get(editor, 'view')
    if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 120, 600)
    editor.openDocument({
      documentId: 'main.ts',
      languageId: 'typescript',
      text: MOUNTED_LINES.join('\n'),
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('holds the enclosing headers on screen while the document scrolls under them', async () => {
    const rowHeight = mountedRowHeight()
    const root = () => container.querySelector<HTMLElement>('.editor-sticky-scroll')

    expect(root()?.hidden).toBe(true)

    editor.setScrollPosition({ top: 20 * rowHeight })

    await expect.poll(mountedStickyLines).toEqual(['function outer() {', '  if (a) {'])
    expect(root()?.style.top).toBe('0px')
    expect(root()?.style.height).toBe(`${(MOUNTED_INNER_END_ROW + 1) * rowHeight}px`)
    expect(mountedStack()?.style.height).toBe(`${2 * rowHeight}px`)

    editor.setScrollPosition({ top: 0 })

    expect(root()?.hidden).toBe(true)
  })

  /**
   * The rows in the stack are already in the document, so a reader who reaches them there reaches
   * them twice, and a caret that lands in one of them is a caret in a copy of the text.
   */
  it('keeps the stack out of the focus order, out of the reading order, and unwritable', async () => {
    editor.setScrollPosition({ top: 20 * mountedRowHeight() })
    await expect.poll(mountedStack).not.toBeNull()
    const stack = mountedStack()!
    const input = stack.querySelector<HTMLTextAreaElement>('textarea')!

    expect(container.querySelector('.editor-sticky-scroll')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(stack.tabIndex).toBe(-1)
    expect(input.tabIndex).toBe(-1)
    expect(input.readOnly).toBe(true)
  })
})

const highlightRegistry = new Map<string, Highlight>()

function mountedRowHeight(): number {
  const view = document.querySelector<HTMLElement>('.editor-virtualized')
  return Number.parseFloat(view!.style.getPropertyValue('--editor-row-height'))
}

function mountedStack(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.editor-sticky-scroll-lines')
}

function mountedStickyLines(): readonly string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.editor-sticky-scroll .editor-virtualized-row:not([hidden])',
    ),
  ].map((row) => row.textContent ?? '')
}

function registeredProvider(plugin: ReturnType<typeof createStickyScrollPlugin>) {
  let registration: EditorViewContributionProvider | undefined
  plugin.activate(
    createPluginContext((provider) => {
      registration = provider
      return { dispose: vi.fn() }
    }),
  )
  return registration
}

function createPluginContext(
  registerViewContribution: EditorPluginContext['registerViewContribution'],
): EditorPluginContext {
  return createTestPluginContext({
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerViewContribution,
    registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
  })
}

function context(viewSnapshot = snapshot()): EditorViewContributionContext {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  const contentElement = document.createElement('div')
  scrollElement.appendChild(contentElement)
  container.appendChild(scrollElement)
  document.body.appendChild(container)
  return createTestViewContributionContext({
    container,
    scrollElement,
    contentElement,
    highlightPrefix: 'sticky-test',
    getSnapshot: () => viewSnapshot,
  })
}

function stickyRoot(context: EditorViewContributionContext): HTMLElement | null {
  return context.scrollElement.querySelector<HTMLElement>('.editor-sticky-scroll')
}

function stickyLineView(context: EditorViewContributionContext): HTMLElement | null {
  return context.scrollElement.querySelector<HTMLElement>('.editor-sticky-scroll-lines')
}

function mirroredLines(context: EditorViewContributionContext): readonly string[] {
  return [
    ...context.scrollElement.querySelectorAll<HTMLElement>(
      '.editor-sticky-scroll .editor-virtualized-row:not([hidden])',
    ),
  ].map((row) => row.textContent ?? '')
}

/** Scrolled far enough that both scope headers are above the viewport. */
function scrolledSnapshot(scrollTop: number): EditorViewSnapshot {
  const firstRow = Math.floor(scrollTop / ROW_HEIGHT)
  return {
    ...snapshot(),
    visibleRows: visibleRows(firstRow, LINES.length - 1),
    viewport: { ...snapshot().viewport, scrollTop, scrollRow: scrollTop / ROW_HEIGHT },
  }
}

function snapshot(): EditorViewSnapshot {
  return {
    documentId: 'sticky-test',
    languageId: 'typescript',
    syntaxStatus: 'ready',
    paintLayers: [],
    ...createTestViewSnapshotSource(TEXT),
    textVersion: 1,
    initialHighlightStatus: 'painted',
    documentSyncPoint: {
      revision: 1,
      segment: Object.freeze({}) as EditorViewSnapshot['documentSyncPoint']['segment'],
      textVersion: 1,
    },
    changesSinceDocumentSyncPoint: () => null,
    lineStarts: lineStarts(),
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: ROW_HEIGHT, characterWidth: 8 },
    lineCount: LINES.length,
    contentWidth: 160,
    totalHeight: LINES.length * ROW_HEIGHT,
    gutterWidth: 0,
    gutterLayout: { fixedWidth: 0, lanes: [] },
    tabSize: 2,
    foldMarkers: foldMarkers(),
    visibleRows: visibleRows(0, LINES.length - 1),
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: LINES.length * ROW_HEIGHT,
      scrollWidth: 160,
      clientHeight: 100,
      clientWidth: 320,
      borderBoxHeight: 100,
      borderBoxWidth: 320,
      visibleRange: { start: 0, end: LINES.length },
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

/** The two regions an indentation walk finds in the fixture, each ending on its last body row. */
function foldMarkers(): readonly VirtualizedFoldMarker[] {
  const starts = lineStarts()
  return [
    {
      key: 'indent:outer',
      startOffset: lineEnd(starts, 0),
      endOffset: lineEnd(starts, 5),
      startRow: 0,
      endRow: 5,
      collapsed: false,
    },
    {
      key: 'indent:if',
      startOffset: lineEnd(starts, 2),
      endOffset: lineEnd(starts, 4),
      startRow: 2,
      endRow: 4,
      collapsed: false,
    },
  ]
}

/** The fixture's regions plus one more opening on row 0, the way a query pairs two nodes there. */
function sameRowFoldMarkers(): readonly VirtualizedFoldMarker[] {
  const starts = lineStarts()
  const [outer, inner] = foldMarkers()
  return [
    outer!,
    {
      key: 'query:same-row',
      startOffset: outer!.startOffset,
      endOffset: lineEnd(starts, 4),
      startRow: 0,
      endRow: 4,
      collapsed: false,
    },
    inner!,
  ]
}

function tokens(): readonly EditorToken[] {
  const starts = lineStarts()
  return [
    { start: 0, end: 8, style: { color: 'keyword' } },
    { start: starts[2]! + 2, end: starts[2]! + 4, style: { color: 'control' } },
    { start: starts[3]! + 4, end: starts[3]! + 9, style: { color: 'function' } },
  ]
}

/** Scopes nested past the number of rows the stack may ever hold, and a body long enough to hold. */
const DEEP_DEPTH = 7
const DEEP_LINES = Array.from(
  { length: DEEP_DEPTH },
  (_, level) => `${'  '.repeat(level)}level${level}() {`,
).concat(
  Array.from({ length: 24 }, (_, index) => `${'  '.repeat(DEEP_DEPTH)}step(${index})`),
  Array.from({ length: DEEP_DEPTH }, (_, index) => `${'  '.repeat(DEEP_DEPTH - 1 - index)}}`),
)
const DEEP_TEXT = DEEP_LINES.join('\n')

/** Scrolled past every header row, so each of the scopes wants a slot in the stack. */
function deepSnapshot(): EditorViewSnapshot {
  const starts = textLineStarts(DEEP_TEXT)
  const rowEnd = (row: number): number => starts[row]! + DEEP_LINES[row]!.length
  const rows: EditorVisibleRowSnapshot[] = []
  for (let row = DEEP_DEPTH; row < DEEP_LINES.length; row += 1) {
    rows.push({
      index: row,
      bufferRow: row,
      source: 'document',
      startOffset: starts[row]!,
      endOffset: rowEnd(row),
      text: DEEP_LINES[row]!,
      kind: 'text',
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
    })
  }

  return {
    ...snapshot(),
    ...createTestViewSnapshotSource(DEEP_TEXT),
    lineStarts: starts,
    lineCount: DEEP_LINES.length,
    foldMarkers: Array.from({ length: DEEP_DEPTH }, (_, level) => ({
      key: `indent:${level}`,
      startOffset: rowEnd(level),
      endOffset: rowEnd(DEEP_LINES.length - 1 - level),
      startRow: level,
      endRow: DEEP_LINES.length - 1 - level,
      collapsed: false,
    })),
    visibleRows: rows,
    viewport: {
      ...snapshot().viewport,
      scrollTop: DEEP_DEPTH * ROW_HEIGHT,
      scrollRow: DEEP_DEPTH,
      scrollHeight: DEEP_LINES.length * ROW_HEIGHT,
    },
  }
}

function visibleRows(from: number, to: number): EditorViewSnapshot['visibleRows'] {
  const starts = lineStarts()
  const rows: EditorVisibleRowSnapshot[] = []
  for (let row = from; row <= to; row += 1) {
    rows.push({
      index: row,
      bufferRow: row,
      source: 'document',
      startOffset: starts[row]!,
      endOffset: lineEnd(starts, row),
      text: LINES[row]!,
      kind: 'text',
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
    })
  }
  return rows
}

function lineEnd(starts: readonly number[], row: number): number {
  return starts[row]! + LINES[row]!.length
}

function lineStarts(): readonly number[] {
  return textLineStarts(TEXT)
}

function textLineStarts(text: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}
