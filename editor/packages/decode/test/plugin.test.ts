// NOT-PORTABLE: Imports ignored editor/dist; direct tests require a prior workspace build.
import {
  acquireRowPresentation,
  invalidateRowPresentations,
} from '../../editor/dist/rowPresentation'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EditorRowPresentation,
  EditorPluginContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { createDecodePlugin, type DecodePluginOptions } from '../src/index'
import { tokenizeLengths } from '../src/tokenize'
import { collectRevealRows } from '../src/rows'
import { RangeText } from '../../editor/dist/textContent'
import { measureString } from '../../editor/dist/textMeasurements'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

const SAMPLE = 'function f() {\n  if (x) {\n    y()\n  }\n}\n'
const TEST_DOCUMENT_SYNC_SEGMENT = Object.freeze(
  {},
) as EditorViewSnapshot['documentSyncPoint']['segment']

type RecordedAnimation = {
  readonly element: HTMLElement
  readonly keyframes: Keyframe[]
  readonly options: KeyframeAnimationOptions
  readonly cancel: ReturnType<typeof vi.fn>
}

let recorded: RecordedAnimation[] = []
let originalAnimate: typeof HTMLElement.prototype.animate

beforeEach(() => {
  recorded = []
  originalAnimate = HTMLElement.prototype.animate
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const cancel = vi.fn()
    recorded.push({
      element: this,
      keyframes: (Array.isArray(keyframes) ? keyframes : []) as Keyframe[],
      options: (options ?? {}) as KeyframeAnimationOptions,
      cancel,
    })
    return {
      finished: new Promise<Animation>(() => {}),
      cancel,
      playState: 'running',
    } as unknown as Animation
  } as typeof HTMLElement.prototype.animate
})

afterEach(() => {
  HTMLElement.prototype.animate = originalAnimate
  vi.restoreAllMocks()
})

const rowAnimations = () =>
  recorded.filter((entry) => entry.element.classList.contains('editor-virtualized-row'))
const caretAnimations = () =>
  recorded.filter((entry) => entry.element.classList.contains('editor-decode-caret'))
const caretLayer = (context: EditorViewContributionContext) =>
  context.scrollElement.querySelector('.editor-decode-caret-layer')
const caretElements = (context: EditorViewContributionContext) =>
  context.scrollElement.querySelectorAll('.editor-decode-caret')

describe('createDecodePlugin', () => {
  it('registers a single view contribution', () => {
    const registerViewContribution = vi.fn<EditorPluginContext['registerViewContribution']>(() => ({
      dispose: vi.fn(),
    }))
    const plugin = createDecodePlugin()

    const disposable = plugin.activate(pluginContext(registerViewContribution))

    expect(plugin.name).toBe('editor.decode')
    expect(disposable).toBeDefined()
    expect(registerViewContribution).toHaveBeenCalledOnce()
  })

  it.each([{ scrollTop: 40, scrollRow: 2 }, { scrollLeft: 8 }, { scrollTop: 1 }])(
    'cancels an active reveal on viewport change %j',
    (change) => {
      const { context, contribution } = mount()
      contribution.update(snapshot({ tokens: someTokens() }), 'document')
      expect(rowAnimations().length).toBeGreaterThan(0)
      contribution.updateViewport?.({ ...snapshot().viewport, ...change })
      expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
      expect(rowAnimations().every((animation) => animation.cancel.mock.calls.length > 0)).toBe(
        true,
      )
    },
  )

  it('keeps a pending reveal through viewport restoration until highlighting settles', () => {
    const { context, contribution } = mount()
    contribution.update(loading(), 'document')
    contribution.updateViewport?.({ ...snapshot().viewport, scrollTop: 40, scrollRow: 2 })
    contribution.update(snapshot({ tokens: someTokens() }), 'tokens')
    expect(rowAnimations().length).toBeGreaterThan(0)
    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(true)
    contribution.dispose()
  })

  it.each(['autoregressive', 'diffusion'] as const)(
    'cancels %s on real row invalidation and releases every handle',
    (mode) => {
      const { context, contribution, presentations } = mount({ mode })
      contribution.update(snapshot({ tokens: someTokens() }), 'document')
      expect(presentations.length).toBeGreaterThan(0)
      invalidateRowPresentations(presentations[0]!.element)
      expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
      expect(caretLayer(context)).toBeNull()
      expect(context.scrollElement.querySelector('.editor-decode-glyph-layer')).toBeNull()
      expect(recorded.every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
      expect(
        presentations.every((handle) => vi.mocked(handle.dispose).mock.calls.length === 1),
      ).toBe(true)
      contribution.dispose()
      expect(
        presentations.every((handle) => vi.mocked(handle.dispose).mock.calls.length === 1),
      ).toBe(true)
    },
  )

  it.each(['viewport', 'input', 'dispose', 'document'] as const)(
    'releases row handles on %s cancellation',
    (reason) => {
      const { context, contribution, presentations } = mount()
      contribution.update(snapshot({ tokens: someTokens() }), 'document')
      const initial = [...presentations]
      expect(initial.length).toBeGreaterThan(0)
      if (reason === 'viewport') contribution.updateViewport?.(snapshot().viewport)
      if (reason === 'input') context.scrollElement.dispatchEvent(new Event('keydown'))
      if (reason === 'dispose') contribution.dispose()
      if (reason === 'document') contribution.update(snapshot({ documentId: 'next' }), 'document')
      expect(initial.every((handle) => vi.mocked(handle.dispose).mock.calls.length === 1)).toBe(
        true,
      )
      contribution.dispose()
    },
  )

  it('hides the real rows on open but waits for the highlight to settle before revealing', () => {
    const { context, contribution } = mount()

    contribution.update(loading(), 'document')

    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(true)
    expect(rowAnimations()).toHaveLength(0)
    expect(caretLayer(context)).toBeNull()
  })

  it('reveals each real row with a caret once the highlight settles', () => {
    const { context, contribution } = mount()
    const withTokens = snapshot({ tokens: someTokens() })

    contribution.update(loading(), 'document')
    contribution.update(withTokens, 'tokens')

    const expected = withTokens.visibleRows.filter((r) => r.kind === 'text' && r.text.length > 0)
    expect(rowAnimations()).toHaveLength(expected.length)
    expect(caretElements(context)).toHaveLength(expected.length)
    expect(caretAnimations().length).toBeGreaterThan(0)
    expect(caretLayer(context)).not.toBeNull()
    expect(caretLayer(context)?.parentElement).toBe(context.contentElement)
  })

  it('starts immediately when the opened document is already tokenized', () => {
    const { context, contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(rowAnimations().length).toBeGreaterThan(0)
    expect(caretElements(context).length).toBe(rowAnimations().length)
  })

  it('starts on the settled status alone, with no timer behind it', () => {
    vi.useFakeTimers()
    try {
      const { context, contribution } = mount()
      contribution.update(loading(), 'document')

      vi.advanceTimersByTime(60_000)
      expect(rowAnimations()).toHaveLength(0)
      expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(true)

      contribution.update(loading(), 'tokens')
      expect(rowAnimations()).toHaveLength(0)

      // A highlight that ended in error settles too; the reveal starts uncoloured.
      contribution.update(snapshot({ initialHighlightStatus: 'error' }), 'tokens')
      expect(rowAnimations().length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts at once for a document that has no highlighter', () => {
    const { contribution } = mount()
    contribution.update(snapshot({ initialHighlightStatus: 'plain' }), 'document')

    expect(rowAnimations().length).toBeGreaterThan(0)
  })

  it('shows the document at once on input while it waits', () => {
    const { context, contribution } = mount()
    contribution.update(loading(), 'document')

    context.scrollElement.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    contribution.update(snapshot({ tokens: someTokens() }), 'tokens')

    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
    expect(rowAnimations()).toHaveLength(0)
  })

  it('schedules autoregressive sequentially and parallel with jittered starts', () => {
    mount({ mode: 'autoregressive' }).contribution.update(
      snapshot({ tokens: someTokens() }),
      'document',
    )
    expect(rowAnimations()[0]?.options.delay).toBe(0)
    expect(Number(rowAnimations()[1]?.options.delay)).toBeGreaterThan(0)
    expect(String(rowAnimations()[0]?.options.easing)).toMatch(/^steps\(/)

    recorded = []
    mount({ mode: 'parallel', staggerMs: 200 }).contribution.update(
      snapshot({ tokens: someTokens() }),
      'document',
    )
    const delays = rowAnimations().map((entry) => Number(entry.options.delay))
    // Jittered into [0, staggerMs), and not a single uniform cascade value.
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...delays)).toBeLessThan(200)
    expect(new Set(delays).size).toBeGreaterThan(1)
  })

  it('token mode steps one token at a time, sequentially across rows', () => {
    mount({ mode: 'token' }).contribution.update(snapshot({ tokens: someTokens() }), 'document')

    const clips = rowAnimations()
    expect(clips.length).toBeGreaterThan(0)

    // First row "function f() {" → a hidden start frame plus one per token.
    const firstRow = SAMPLE.split('\n')[0] ?? ''
    const clip = clips[0]
    expect(clip?.keyframes).toHaveLength(tokenizeLengths(firstRow).length + 1)
    // Stepped via per-keyframe step-end, not a top-level steps()/linear easing.
    expect(clip?.options.easing).toBeUndefined()
    expect(clip?.keyframes.every((frame) => frame.easing === 'step-end')).toBe(true)
    expect(clip?.keyframes.at(-1)?.offset).toBe(1)

    // Autoregressive across rows: first starts at 0, the next strictly later.
    expect(clips[0]?.options.delay).toBe(0)
    expect(Number(clips[1]?.options.delay)).toBeGreaterThan(0)
  })

  it('scales timings by the speed option', () => {
    mount({ mode: 'autoregressive' }).contribution.update(
      snapshot({ tokens: someTokens() }),
      'document',
    )
    const base = Number(rowAnimations()[0]?.options.duration)

    recorded = []
    mount({ mode: 'autoregressive', speed: 2 }).contribution.update(
      snapshot({ tokens: someTokens() }),
      'document',
    )
    const fast = Number(rowAnimations()[0]?.options.duration)

    expect(base).toBeGreaterThan(0)
    expect(fast).toBeCloseTo(base / 2, 5)
  })

  it('ignores non-document updates and empty documents', () => {
    const selectionOnly = mount()
    selectionOnly.contribution.update(snapshot({ tokens: someTokens() }), 'selection')
    expect(selectionOnly.context.scrollElement.classList.contains('editor-decode-active')).toBe(
      false,
    )

    const empty = mount()
    empty.contribution.update(snapshot({ text: '', visibleRows: [] }), 'document')
    expect(empty.context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
  })

  it('does not re-trigger for the same document id', () => {
    const { contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')
    const firstCount = rowAnimations().length

    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(rowAnimations()).toHaveLength(firstCount)
  })

  it('cancels instantly on user input', () => {
    const { context, contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    context.scrollElement.dispatchEvent(new Event('keydown', { bubbles: true }))

    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
    expect(caretLayer(context)).toBeNull()
    expect(recorded.every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
  })

  it('tears down on dispose', () => {
    const { context, contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    contribution.dispose()

    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
    expect(caretLayer(context)).toBeNull()
    expect(recorded.every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
  })

  it('does nothing under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { context, contribution } = mount()

    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
    expect(recorded).toHaveLength(0)
  })
})

describe('createDecodePlugin diffusion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const glyphLayer = (context: EditorViewContributionContext) =>
    context.scrollElement.querySelector('.editor-decode-glyph-layer')
  const glyphs = (context: EditorViewContributionContext) => [
    ...context.scrollElement.querySelectorAll<HTMLElement>('.editor-decode-glyph'),
  ]
  // A blank cell holds a space to keep its column width; "filled" = a real glyph.
  const occupied = (context: EditorViewContributionContext) =>
    glyphs(context).filter((span) => (span.textContent ?? '').trim().length > 0)

  it('starts blank — a span per character, none filled yet', () => {
    const { context, contribution } = mount({ mode: 'diffusion' })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    const visibleChars = SAMPLE.replace(/\s/g, '').length
    expect(glyphLayer(context)).not.toBeNull()
    expect(glyphLayer(context)?.parentElement).toBe(context.contentElement)
    expect(glyphs(context)).toHaveLength(visibleChars)
    // Real rows stay clipped-hidden the whole time; the overlay is all you see.
    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(true)
    // Diffusion starts from empty: every span exists but is blank.
    expect(occupied(context)).toHaveLength(0)
    // Each span already carries its final colour (offset 0 is inside the token).
    expect(glyphs(context)[0]?.style.color).toBe('var(--editor-syntax-keyword)')
  })

  it('fills in over steps — density grows from sparse to full', () => {
    const { context, contribution } = mount({ mode: 'diffusion', maxDurationMs: 1000 })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    vi.advanceTimersByTime(250) // wavefront just entering the field
    const early = occupied(context).length
    vi.advanceTimersByTime(100) // a few steps later
    const mid = occupied(context).length

    // Sparse early, denser later, and not yet everything (clusters still emerging).
    expect(early).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(early)
    expect(mid).toBeLessThan(glyphs(context).length)
  })

  it('converges and hands off to the real rows', () => {
    const { context, contribution, presentations } = mount({
      mode: 'diffusion',
      maxDurationMs: 1000,
    })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    vi.advanceTimersByTime(2000)
    expect(presentations.length).toBeGreaterThan(0)
    expect(presentations.every((handle) => vi.mocked(handle.dispose).mock.calls.length === 1)).toBe(
      true,
    )
    expect(presentations.every((handle) => !handle.signal.aborted)).toBe(true)

    expect(glyphLayer(context)).toBeNull()
    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
  })

  it('cancels on user input', () => {
    const { context, contribution } = mount({ mode: 'diffusion' })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    context.scrollElement.dispatchEvent(new Event('keydown', { bubbles: true }))

    expect(glyphLayer(context)).toBeNull()
    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
    // The tick is stopped — advancing time does not resurrect the overlay.
    vi.advanceTimersByTime(2000)
    expect(glyphLayer(context)).toBeNull()
  })
})

it('animates only mounted long-line text at its horizontal position', () => {
  const context = viewContext()
  const readRange = vi.fn(() => '')
  const base = snapshot().visibleRows[0]!
  const chunk = {
    sourceStartOffset: 1000,
    sourceEndOffset: 1064,
    rowLocalStart: 1000,
    rowLocalEnd: 1064,
    text: new RangeText(64, readRange, measureString('x'.repeat(64))),
    mountedPaint: { kind: 'replayable', parts: [{ kind: 'text', text: 'x'.repeat(64) }] },
  } as const
  const current = snapshot({
    visibleRows: [
      {
        ...base,
        text: new RangeText(1_000_000, readRange, measureString('x'.repeat(1_000_000))),
        leftSpacerWidth: 8000,
        chunks: [chunk],
      },
    ],
  })
  const element = document.createElement('div')
  element.className = 'editor-virtualized-row'
  element.dataset.editorVirtualRow = String(base.index)
  element.textContent = chunk.mountedPaint.parts[0].text
  context.scrollElement.appendChild(element)

  const rows = collectRevealRows(context, current, 20)

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    text: 'x'.repeat(64),
    startOffset: 1000,
    length: 64,
    leftSpacerWidth: 8000,
  })
  expect(readRange).not.toHaveBeenCalled()
})

function mount(options: DecodePluginOptions = {}): {
  context: EditorViewContributionContext
  contribution: EditorViewContribution
  presentations: EditorRowPresentation[]
} {
  const provider = registeredProvider(createDecodePlugin(options))
  const presentations: EditorRowPresentation[] = []
  const context = viewContext(presentations)
  populateRows(context.contentElement, snapshot())
  const contribution = provider?.createContribution(context)
  if (!contribution) throw new Error('decode contribution was not created')
  return { context, contribution, presentations }
}

/** Stand in for the editor's already-rendered, highlight-painted row elements. */
function populateRows(scroll: HTMLElement, snap: EditorViewSnapshot): void {
  for (const row of snap.visibleRows) {
    if (row.kind !== 'text' || row.text.length === 0) continue

    const element = document.createElement('div')
    element.className = 'editor-virtualized-row'
    element.dataset.editorVirtualRow = String(row.index)
    element.textContent =
      typeof row.text === 'string' ? row.text : row.text.slice(0, row.text.length)
    scroll.appendChild(element)
  }
}

function registeredProvider(
  plugin: ReturnType<typeof createDecodePlugin>,
): EditorViewContributionProvider | undefined {
  let registration: EditorViewContributionProvider | undefined
  plugin.activate(
    pluginContext((provider) => {
      registration = provider
      return { dispose: vi.fn() }
    }),
  )
  return registration
}

function pluginContext(
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

function viewContext(presentations: EditorRowPresentation[] = []): EditorViewContributionContext {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  const contentElement = document.createElement('div')
  scrollElement.appendChild(contentElement)
  container.appendChild(scrollElement)
  return createTestViewContributionContext({
    container,
    scrollElement,
    contentElement,
    getRowPresentation(index) {
      const element = scrollElement.querySelector<HTMLElement>(
        `[data-editor-virtual-row="${index}"]`,
      )
      if (!element) return null
      const handle = acquireRowPresentation(element)
      if (!handle) return null
      vi.spyOn(handle, 'dispose')
      presentations.push(handle)
      return handle
    },
    getSnapshot: () => snapshot({ tokens: someTokens() }),
  })
}

function snapshot({
  text = SAMPLE,
  ...overrides
}: Partial<EditorViewSnapshot> & { readonly text?: string } = {}): EditorViewSnapshot {
  return {
    documentId: 'decode-test',
    languageId: 'typescript',
    syntaxStatus: 'ready',
    paintLayers: [],
    ...createTestViewSnapshotSource(text),
    textVersion: 1,
    lineStarts: lineStarts(text),
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: lineStarts(text).length,
    contentWidth: 160,
    totalHeight: 120,
    tabSize: 2,
    foldMarkers: [],
    visibleRows: visibleRows(text),
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 120,
      scrollWidth: 160,
      clientHeight: 80,
      clientWidth: 120,
      borderBoxHeight: 80,
      borderBoxWidth: 120,
      visibleRange: { start: 0, end: 6 },
    },
    ...overrides,
    initialHighlightStatus: overrides.initialHighlightStatus ?? 'painted',
    gutterWidth: overrides.gutterWidth ?? 0,
    gutterLayout: overrides.gutterLayout ?? { leadingInset: 0, fixedWidth: 0, lanes: [] },
    toVisibleSnapshot: overrides.toVisibleSnapshot ?? (() => null),
    documentSyncPoint: overrides.documentSyncPoint ?? {
      revision: overrides.textVersion ?? 1,
      segment: TEST_DOCUMENT_SYNC_SEGMENT,
      textVersion: overrides.textVersion ?? 1,
    },
    changesSinceDocumentSyncPoint: overrides.changesSinceDocumentSyncPoint ?? (() => null),
  }
}

function loading(): EditorViewSnapshot {
  return snapshot({ tokens: EditorTokenStore.empty(), initialHighlightStatus: 'loading' })
}

function someTokens(): EditorViewSnapshot['tokens'] {
  return EditorTokenStore.fromTokens([
    { start: 0, end: 8, style: { color: 'var(--editor-syntax-keyword)' } },
  ])
}

function visibleRows(text: string): EditorViewSnapshot['visibleRows'] {
  const starts = lineStarts(text)
  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? text.length + 1
    const end = Math.max(start, Math.min(text.length, nextStart - 1))
    return {
      index,
      bufferRow: index,
      source: 'document',
      startOffset: start,
      endOffset: end,
      text: text.slice(start, end),
      kind: 'text',
      primaryText: true,
      firstWrapSegment: true,
      top: index * 20,
      height: 20,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    }
  })
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}
