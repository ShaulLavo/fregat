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
  createFileTransitionPlugin,
  createFileEditAnimationPlugin,
  type FileTransitionPluginOptions,
  type FileEditAnimationPluginOptions,
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
// The cover holds a row invisible for as long as the overlay draws it.
const coverAnimations = () =>
  rowAnimations().filter(
    (entry) => entry.keyframes[0]?.opacity === 0 && entry.keyframes[1]?.opacity === 0,
  )
const pieceSpans = (context: EditorViewContributionContext) =>
  Array.from(context.contentElement.querySelectorAll<HTMLElement>('.editor-morph-piece'))
const pieceDelays = () =>
  recorded
    .filter((entry) => entry.element.classList.contains('editor-morph-piece'))
    .map((entry) => Number(entry.options.delay ?? 0))
const carets = (context: EditorViewContributionContext) =>
  context.contentElement.querySelectorAll('.editor-file-transition-caret')
const revealLayer = (context: EditorViewContributionContext) =>
  context.contentElement.querySelector('.editor-file-transition-layer')

describe('createFileTransitionPlugin', () => {
  it('registers a single view contribution', () => {
    const registerViewContribution = vi.fn<EditorPluginContext['registerViewContribution']>(() => ({
      dispose: vi.fn(),
    }))
    const plugin = createFileTransitionPlugin()

    const disposable = plugin.activate(pluginContext(registerViewContribution))

    expect(plugin.name).toBe('editor.fileTransition')
    expect(disposable).toBeDefined()
    expect(registerViewContribution).toHaveBeenCalledOnce()
  })

  it('starts the moment a document opens, before its highlight settles', () => {
    const { context, contribution } = mount()
    contribution.update(loading(), 'document')

    expect(revealLayer(context)).not.toBeNull()
    expect(pieceSpans(context).length).toBeGreaterThan(0)
    expect(rowAnimations().length).toBeGreaterThan(0)
    expect(context.scrollElement.classList.contains('editor-file-transition-active')).toBe(true)
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
      expect(context.scrollElement.classList.contains('editor-file-transition-active')).toBe(false)
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

describe('magic move', () => {
  const MOVED = '  if (x) {\n    y()\n  }\nfunction f() {\n}\n'
  const fromY = (entry: RecordedAnimation) =>
    Number(/translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(String(entry.keyframes[0]?.transform))?.[1])

  it('slides the text two files share from where it stood in the previous file', () => {
    const { context, contribution } = mount({ mode: 'magicMove' })
    contribution.update(snapshot(), 'layout')
    contribution.update(snapshot({ documentId: 'other', text: MOVED, textVersion: 2 }), 'document')

    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()
    const rowHeight = snapshot().metrics.rowHeight
    // `function` stood on the first row and now stands on the fourth.
    const moved = recorded.filter((entry) => entry.element.textContent === 'function')
    expect(moved.map(fromY)).toEqual([-3 * rowHeight])
    expect(enterAnimations()).toHaveLength(0)
    contribution.dispose()
  })

  it('moves from the file another editor opened last, like the previous tab', () => {
    const provider = registeredProvider(createFileTransitionPlugin({ mode: 'magicMove' }))
    const firstContext = viewContext()
    populateRows(firstContext.contentElement, snapshot())
    const first = provider?.createContribution(firstContext)
    first?.update(snapshot({ documentId: 'previous-tab' }), 'document')
    first?.dispose()
    recorded = []

    const secondContext = viewContext()
    populateRows(secondContext.contentElement, snapshot({ text: MOVED }))
    const second = provider?.createContribution(secondContext)
    second?.update(snapshot({ documentId: 'next-tab', text: MOVED, textVersion: 2 }), 'document')

    const moved = recorded.filter((entry) => entry.element.textContent === 'function')
    expect(moved.map(fromY)).toEqual([-3 * snapshot().metrics.rowHeight])
    second?.dispose()
  })

  it('keeps a rendered row fading in after an overlay with nothing to draw is done', async () => {
    const provider = registeredProvider(createFileTransitionPlugin({ mode: 'magicMove' }))
    const context = { ...viewContext(), hasDocument: () => false }
    populateRows(context.contentElement, snapshot({ text: 'heading\n' }))
    // The whole file renders as something other than its source.
    vi.spyOn(context, 'getInlineReplacementRanges').mockReturnValue([{ start: 0, end: 7 }])
    const contribution = provider?.createContribution(context)
    contribution?.update(snapshot({ documentId: 'heading', text: 'heading\n' }), 'document')
    const fade = rowAnimations().find((entry) => entry.keyframes[0]?.opacity === 0)
    expect(fade).toBeDefined()

    await Promise.resolve()
    await Promise.resolve()

    expect(fade!.cancel).not.toHaveBeenCalled()
    contribution?.dispose()
  })

  it('slides a rendered row across from another editor beside this one', () => {
    const provider = registeredProvider(createFileTransitionPlugin({ mode: 'magicMove' }))
    const left = viewContext()
    vi.spyOn(left.scrollElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 400),
    )
    document.body.append(left.scrollElement)
    vi.spyOn(left, 'getInlineReplacementRanges').mockReturnValue([{ start: 0, end: 7 }])
    const first = provider?.createContribution(left)
    first?.update(snapshot({ documentId: 'left', text: 'heading\n' }), 'document')

    const right = viewContext()
    vi.spyOn(right.scrollElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(400, 0, 400, 400),
    )
    document.body.append(right.scrollElement)
    vi.spyOn(right, 'getInlineReplacementRanges').mockReturnValue([{ start: 0, end: 7 }])
    populateRows(right.contentElement, snapshot({ text: 'heading\n' }))
    recorded = []
    const second = provider?.createContribution(right)
    second?.update(snapshot({ documentId: 'right', text: 'heading\n' }), 'document')

    const slide = rowAnimations().find((entry) => entry.keyframes[0]?.translate !== undefined)
    expect(slide?.keyframes[0]?.translate).toBe('-400px 0px')
    first?.dispose()
    second?.dispose()
    left.scrollElement.remove()
    right.scrollElement.remove()
  })

  it('brings the first file in when nothing came before it', () => {
    const provider = registeredProvider(createFileTransitionPlugin({ mode: 'magicMove' }))
    const context = { ...viewContext(), hasDocument: () => false }
    populateRows(context.contentElement, snapshot({ text: MOVED }))
    const contribution = provider?.createContribution(context)
    if (!contribution) throw new Error('file transition contribution was not created')
    contribution.update(snapshot({ documentId: 'first', text: MOVED, textVersion: 2 }), 'document')

    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()
    expect(enterAnimations().length).toBeGreaterThan(0)
    contribution.dispose()
  })

  it('places the previous file where it stood on screen when the new one opens scrolled', () => {
    const { contribution } = mount({ mode: 'magicMove' })
    contribution.update(snapshot(), 'layout')
    const opened = snapshot({ documentId: 'other', text: SAMPLE, textVersion: 2 })
    const scrolled = { ...opened, viewport: { ...opened.viewport, scrollTop: 40 } }
    contribution.update(scrolled, 'document')

    const moved = recorded.filter((entry) => entry.element.textContent === 'function')
    // The same row on screen sits 40px further down the content of the scrolled file.
    expect(moved.map(fromY)).toEqual([40])
    contribution.dispose()
  })
})

const EDITED = 'function f(a: number) {\n  if (x) {\n    y(a)\n  }\n}\n'

describe('createFileEditAnimationPlugin', () => {
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
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', typed(1))

    expect(context.contentElement.querySelector('.editor-morph-layer')).toBeNull()
    expect(rowAnimations()).toHaveLength(0)
  })

  it('morphs a command edit however small it is', () => {
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(1))

    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()
    contribution.dispose()
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
    const { context, contribution } = mountMorph()
    contribution.update(snapshot({ text: EDITED, textVersion: 2 }), 'content', edit(12))
    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()

    contribution.update(snapshot({ text: `${EDITED}a`, textVersion: 3 }), 'content', typed(1))

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

  it('keeps rows whose paint it cannot redraw on screen', () => {
    const { contribution } = mountMorph()
    const next = snapshot({ text: EDITED, textVersion: 2 })
    const rows = next.visibleRows.map((row) => ({
      ...row,
      mountedPaintSupport: 'unreplayable-plugin-css' as const,
    }))
    contribution.update({ ...next, visibleRows: rows }, 'content', edit(12))

    expect(coverAnimations()).toHaveLength(0)
    contribution.dispose()
  })

  it('morphs the other rows when one draws control characters as boxes', () => {
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

    const covered = coverAnimations().map((entry) => entry.element.dataset.editorVirtualRow)
    expect(covered).not.toContain(String(first!.index))
    expect(covered.length).toBeGreaterThan(0)
    expect(context.contentElement.querySelector('.editor-morph-layer')).not.toBeNull()
    contribution.dispose()
  })

  it('stops a rendered row moving when the editor recycles that row', () => {
    const { context, contribution, presentations } = mountMorph()
    const lines = SAMPLE.split('\n')
    const swapped = [lines[0], lines[2], lines[1]].concat(lines.slice(3)).join('\n')
    let replaced = rangeOf(SAMPLE, lines[2]!)
    vi.spyOn(context, 'getInlineReplacementRanges').mockImplementation(() => [replaced])
    contribution.update(snapshot(), 'layout')
    replaced = rangeOf(swapped, lines[2]!)
    contribution.update(snapshot({ text: swapped, textVersion: 2 }), 'content', edit(1))
    const moved = rowAnimations().find((entry) => entry.keyframes[0]?.translate !== undefined)
    expect(moved).toBeDefined()

    invalidateRowPresentations(moved!.element)

    expect(moved!.cancel).toHaveBeenCalled()
    expect(presentations.some((handle) => handle.element === moved!.element)).toBe(true)
    contribution.dispose()
  })

  it('slides a rendered row whole to where its text moved', () => {
    const { context, contribution } = mountMorph()
    const lines = SAMPLE.split('\n')
    const swapped = [lines[0], lines[2], lines[1]].concat(lines.slice(3)).join('\n')
    // `    y()` renders as something other than its source on both sides of the swap.
    let replaced = rangeOf(SAMPLE, lines[2]!)
    vi.spyOn(context, 'getInlineReplacementRanges').mockImplementation(() => [replaced])
    contribution.update(snapshot(), 'layout')
    replaced = rangeOf(swapped, lines[2]!)
    const next = snapshot({ text: swapped, textVersion: 2 })
    contribution.update(next, 'content', edit(1))

    const moved = rowAnimations().find((entry) => entry.element.dataset.editorVirtualRow === '1')
    const rowHeight = next.metrics.rowHeight
    expect(moved?.keyframes).toEqual([{ translate: `0px ${rowHeight}px` }, { translate: '0 0' }])
    const covered = coverAnimations().map((entry) => entry.element.dataset.editorVirtualRow)
    expect(covered).not.toContain('1')
    expect(pieceSpans(context).map((span) => span.textContent)).not.toContain('y')
    contribution.dispose()
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

function rangeOf(text: string, line: string) {
  const start = text.indexOf(line)
  return { start, end: start + line.length }
}

function typed(size: number): EditorContributionChange {
  return { ...edit(size), typing: true }
}

function mountMorph(options: FileEditAnimationPluginOptions = {}): {
  context: EditorViewContributionContext
  contribution: EditorViewContribution
  presentations: EditorRowPresentation[]
} {
  let provider: EditorViewContributionProvider | undefined
  createFileEditAnimationPlugin(options).activate(
    pluginContext((registered) => {
      provider = registered
      return { dispose: vi.fn() }
    }),
  )
  const presentations: EditorRowPresentation[] = []
  const context = viewContext(presentations)
  populateRows(context.contentElement, snapshot())
  const contribution = provider?.createContribution(context)
  if (!contribution) throw new Error('morph contribution was not created')
  return { context, contribution, presentations }
}

function mount(options: FileTransitionPluginOptions = {}): {
  context: EditorViewContributionContext
  contribution: EditorViewContribution
  presentations: EditorRowPresentation[]
} {
  const provider = registeredProvider(createFileTransitionPlugin(options))
  const presentations: EditorRowPresentation[] = []
  const context = viewContext(presentations)
  populateRows(context.contentElement, snapshot())
  const contribution = provider?.createContribution(context)
  if (!contribution) throw new Error('file transition contribution was not created')
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
  plugin: ReturnType<typeof createFileTransitionPlugin>,
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
    documentId: 'transition-test',
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
