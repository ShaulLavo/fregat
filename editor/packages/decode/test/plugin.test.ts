// NOT-PORTABLE: Imports ignored editor/dist; direct tests require a prior workspace build.
import {
  acquireRowPresentation,
  completeRowPresentation,
  invalidateRowPresentations,
} from '../../editor/dist/rowPresentation'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EditorContributionChange,
  EditorRowPresentation,
  EditorPluginContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  createDecodePlugin,
  createMorphPlugin,
  type DecodePluginOptions,
  type MorphPluginOptions,
} from '../src/index'
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
const pieceSpans = (context: EditorViewContributionContext) =>
  Array.from(context.contentElement.querySelectorAll<HTMLElement>('.editor-morph-piece'))
const pieceDelays = () =>
  recorded
    .filter((entry) => entry.element.classList.contains('editor-morph-piece'))
    .map((entry) => Number(entry.options.delay ?? 0))
const carets = (context: EditorViewContributionContext) =>
  context.contentElement.querySelectorAll('.editor-decode-caret')
const revealLayer = (context: EditorViewContributionContext) =>
  context.contentElement.querySelector('.editor-decode-layer')

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

  it('starts the moment a document opens, before its highlight settles', () => {
    const { context, contribution } = mount()
    contribution.update(loading(), 'document')

    expect(revealLayer(context)).not.toBeNull()
    expect(pieceSpans(context).length).toBeGreaterThan(0)
    expect(rowAnimations().length).toBeGreaterThan(0)
    expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(true)
    contribution.dispose()
  })

  it('takes the colours of a highlight that lands mid-reveal', () => {
    const { context, contribution } = mount()
    contribution.update(loading(), 'document')
    expect(pieceSpans(context).some((span) => span.style.color !== '')).toBe(false)

    contribution.update(snapshot({ tokens: someTokens() }), 'tokens')

    expect(pieceSpans(context)[0]?.style.color).toBe('var(--editor-syntax-keyword)')
    contribution.dispose()
  })

  it('streams autoregressive pieces in reading order behind one caret', () => {
    const { context, contribution } = mount({ mode: 'autoregressive' })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    const delays = pieceDelays()
    expect(delays.length).toBeGreaterThan(3)
    expect(delays.every((delay, index) => index === 0 || delay > (delays[index - 1] ?? 0))).toBe(
      true,
    )
    expect(carets(context)).toHaveLength(1)
    contribution.dispose()
  })

  it('types every row at once in parallel, from staggered starts, one caret per row', () => {
    const { context, contribution } = mount({ mode: 'parallel' })
    const opened = snapshot({ tokens: someTokens() })
    contribution.update(opened, 'document')

    const rows = opened.visibleRows.filter((row) => row.text.length > 0).length
    expect(carets(context)).toHaveLength(rows)
    expect(new Set(pieceDelays()).size).toBeGreaterThan(rows / 2)
    contribution.dispose()
  })

  it('stamps one token per perTokenMs, scaled by speed', () => {
    const { contribution } = mount({ mode: 'token', perTokenMs: 40, speed: 2 })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(pieceDelays().slice(0, 4)).toEqual([0, 20, 40, 60])
    contribution.dispose()
  })

  it('resolves diffusion pieces out of two scrambles each, with no caret', () => {
    const { context, contribution } = mount({ mode: 'diffusion' })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    const spans = pieceSpans(context)
    expect(spans.length % 3).toBe(0)
    const noisy = spans.filter((span) => !SAMPLE.includes(span.textContent ?? ''))
    expect(noisy.length).toBeGreaterThan(0)
    expect(carets(context)).toHaveLength(0)
    contribution.dispose()
  })

  it.each(['input', 'edit', 'layout', 'dispose', 'document'] as const)(
    'shows the real rows and drops the overlay on %s',
    (reason) => {
      const { context, contribution, presentations } = mount()
      contribution.update(snapshot({ tokens: someTokens() }), 'document')
      if (reason === 'input') context.scrollElement.dispatchEvent(new Event('keydown'))
      if (reason === 'edit') contribution.update(snapshot({ textVersion: 2 }), 'content', edit(1))
      if (reason === 'layout') {
        contribution.update(snapshot({ metrics: { rowHeight: 24, characterWidth: 8 } }), 'layout')
      }
      if (reason === 'dispose') contribution.dispose()
      if (reason === 'document') {
        contribution.update(snapshot({ documentId: 'next', text: '' }), 'document')
      }

      expect(revealLayer(context)).toBeNull()
      expect(context.scrollElement.classList.contains('editor-decode-active')).toBe(false)
      expect(rowAnimations().every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
      expect(presentations.every((handle) => vi.mocked(handle.dispose).mock.calls.length > 0)).toBe(
        true,
      )
    },
  )

  it('keeps a row hidden when the editor repaints it mid-reveal', () => {
    const { context, contribution } = mount()
    const opened = snapshot({ tokens: someTokens() })
    contribution.update(opened, 'document')
    const row = context.contentElement.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
    invalidateRowPresentations(row)
    completeRowPresentation(row)
    const before = recorded.length

    contribution.update(opened, 'tokens')

    const rehidden = recorded.slice(before).filter((entry) => entry.element === row)
    expect(rehidden).toHaveLength(1)
    expect(rehidden[0]?.cancel).not.toHaveBeenCalled()
    expect(revealLayer(context)).not.toBeNull()
    contribution.dispose()
  })

  it('keeps going through a scroll and a layout pass that moves nothing', () => {
    const { context, contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')
    contribution.updateViewport?.({ ...snapshot().viewport, scrollTop: 40, scrollRow: 2 })
    context.scrollElement.dispatchEvent(new Event('wheel'))
    contribution.update(snapshot({ tokens: someTokens() }), 'layout')

    expect(revealLayer(context)).not.toBeNull()
    contribution.dispose()
  })

  it('reveals a document once, and never an empty one', () => {
    const { context, contribution } = mount()
    contribution.update(snapshot({ documentId: 'empty', text: '' }), 'document')
    expect(revealLayer(context)).toBeNull()

    contribution.update(snapshot({ tokens: someTokens() }), 'document')
    contribution.dispose()
    recorded = []
    contribution.update(snapshot({ tokens: someTokens() }), 'document')
    expect(revealLayer(context)).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('opens a horizontally windowed long line without a reveal', () => {
    const { context, contribution } = mount()
    const opened = snapshot({ tokens: someTokens() })
    const [first, ...rest] = opened.visibleRows
    const windowed: EditorViewSnapshot['visibleRows'][number] = {
      ...first!,
      text: new RangeText(4000, () => 'x'.repeat(4000), measureString('x')),
    }
    contribution.update({ ...opened, visibleRows: [windowed].concat(rest) }, 'document')

    expect(revealLayer(context)).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('opens rows painted with inline replacements without a reveal', () => {
    const { context, contribution } = mount()
    vi.spyOn(context, 'getInlineReplacementRanges').mockReturnValue([{ start: 0, end: 2 }])
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(revealLayer(context)).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('opens without a reveal when more rows are mounted than it may draw', () => {
    const { context, contribution } = mount({ maxRows: 2 })
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(revealLayer(context)).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('settles when a covered row starts painting its text differently', () => {
    const { context, contribution } = mount()
    const opened = snapshot({ tokens: someTokens() })
    contribution.update(opened, 'document')
    const repainted = opened.visibleRows.map((row, index) =>
      index === 0 ? { ...row, mountedPaintSupport: 'unreplayable-plugin-css' as const } : row,
    )
    contribution.update({ ...opened, visibleRows: repainted }, 'tokens')

    expect(revealLayer(context)).toBeNull()
  })

  it('does nothing under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { context, contribution } = mount()
    contribution.update(snapshot({ tokens: someTokens() }), 'document')

    expect(revealLayer(context)).toBeNull()
  })
})

const EDITED = 'function f(a: number) {\n  if (x) {\n    y(a)\n  }\n}\n'

describe('createMorphPlugin', () => {
  it('morphs an edit: the real rows hide under an overlay of pieces', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))

    const layer = context.contentElement.querySelector('.editor-morph-layer')
    expect(layer?.querySelectorAll('.editor-morph-piece').length).toBeGreaterThan(0)
    expect(context.scrollElement.classList.contains('editor-morph-active')).toBe(true)
    expect(rowAnimations().length).toBeGreaterThan(0)
    contribution.dispose()
  })

  it('morphs from the old text when the new text arrived first under viewport', () => {
    const { context, contribution } = mountMorph()
    const next = snapshot({ text: EDITED, textVersion: 2 })
    contribution.update(next, 'viewport')
    contribution.update(next, 'content', edit(12))

    const pieces = Array.from(
      context.contentElement.querySelectorAll('.editor-morph-piece'),
      (piece) => piece.textContent,
    )
    // `number` is new, so it enters: the morph started from the text before the edit.
    expect(pieces).toContain('number')
    expect(enterAnimations().length).toBeGreaterThan(0)
    contribution.dispose()
  })

  it('keeps typing instant', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(1))

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('morphs undo however small it is', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(1, 'undo'))

    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()
    contribution.dispose()
  })

  it('shows the real rows and drops the overlay when a document opens', () => {
    const { context, contribution, presentations } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))
    contribution.update(snapshot({ documentId: 'next', textVersion: 3 }), 'document')

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
    expect(context.scrollElement.classList.contains('editor-morph-active')).toBe(false)
    expect(rowAnimations().every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
    expect(presentations.every((handle) => vi.mocked(handle.dispose).mock.calls.length > 0)).toBe(
      true,
    )
  })

  it('settles a running morph the moment the user types', () => {
    const typing: { listener: ((text: string) => void) | null } = { listener: null }
    const { context, contribution } = mountMorph({}, (listener) => (typing.listener = listener))
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))
    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()

    typing.listener?.('a')

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
    expect(rowAnimations().every((entry) => entry.cancel.mock.calls.length > 0)).toBe(true)
  })

  it('settles when layout changes under a running morph', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))
    contribution.update(
      snapshot({ text: EDITED, textVersion: 2, metrics: { rowHeight: 24, characterWidth: 8 } }),
      'layout',
    )

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
  })

  it('leaves rows alone when their paint cannot be redrawn', () => {
    const { context, contribution } = mountMorph()
    const next = snapshot({ text: EDITED, textVersion: 2 })
    const rows = next.visibleRows.map((row) => ({
      ...row,
      mountedPaintSupport: 'unreplayable-plugin-css' as const,
    }))
    contribution.update({ ...next, visibleRows: rows }, 'content', edit(12))

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('leaves rows alone when they draw control characters as boxes', () => {
    const { context, contribution } = mountMorph()
    const next = snapshot({ text: EDITED, textVersion: 2 })
    const [first, ...rest] = next.visibleRows
    const boxed = {
      ...first!,
      chunks: [
        {
          sourceStartOffset: first!.startOffset,
          sourceEndOffset: first!.endOffset,
          rowLocalStart: 0,
          rowLocalEnd: first!.text.length,
          text: first!.text,
          mountedPaint: {
            kind: 'replayable',
            parts: [{ kind: 'control', text: '\u0007' }],
          },
        },
      ],
    } as unknown as (typeof rest)[number]
    contribution.update({ ...next, visibleRows: [boxed].concat(rest) }, 'content', edit(12))

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
  })

  it('settles when a save sync replaces the text under a running morph', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))
    contribution.update(
      snapshot({ text: SAMPLE, textVersion: 3 }),
      'content',
      edit(1, 'synchronize'),
    )

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
  })

  it('stays still under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
  })
})

const enterAnimations = () =>
  recorded.filter((entry) =>
    entry.keyframes.some((frame) => String(frame.filter ?? '').startsWith('blur(3')),
  )

function edit(size: number, kind: EditorContributionChange['kind'] = 'edit') {
  return {
    kind,
    edits: [{ from: 0, to: 0, text: 'x'.repeat(size) }],
  } as unknown as EditorContributionChange
}

function mountMorph(
  options: MorphPluginOptions = {},
  onDidType?: (listener: (text: string) => void) => void,
): {
  context: EditorViewContributionContext
  contribution: EditorViewContribution
  presentations: EditorRowPresentation[]
} {
  let provider: EditorViewContributionProvider | undefined
  createMorphPlugin(options).activate(
    pluginContext((registered) => {
      provider = registered
      return { dispose: vi.fn() }
    }),
  )
  const presentations: EditorRowPresentation[] = []
  const base = viewContext(presentations)
  const context: EditorViewContributionContext = onDidType
    ? {
        ...base,
        onDidType: (listener) => {
          onDidType(listener)
          return { dispose: vi.fn() }
        },
      }
    : base
  populateRows(context.contentElement, snapshot())
  const contribution = provider?.createContribution(context)
  if (!contribution) throw new Error('morph contribution was not created')
  return { context, contribution, presentations }
}

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
