import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { decodePaintSnapshot } from '../src/editor/paintSnapshot'
import type { EditorGutterContribution, EditorPlugin } from '../src/plugins'
import { createEditorLoggingPlugin } from '../src/logging'
import { setHighlightRegistry } from '../src/public/testing'
import { VirtualizedTextView } from '../src/virtualization'

const TEXT_METRICS = { characterWidth: 8, rowHeight: 20 }
const LANE_WIDTH = 24

let container: HTMLElement
const views: VirtualizedTextView[] = []
const editors: Editor[] = []

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry({ set: () => undefined, delete: () => true })
})

afterEach(() => {
  for (const view of views.splice(0)) view.dispose()
  for (const editor of editors.splice(0)) editor.dispose()
  container.remove()
  setHighlightRegistry(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('gutter leading inset', () => {
  it('leaves an editor without an inset exactly as it was', () => {
    const view = mountView({ gutterContributions: [lane('probe')] })

    expect(view.getState().gutterWidth).toBe(LANE_WIDTH)
    expect(view.getState().gutterLayout).toEqual({
      leadingInset: 0,
      fixedWidth: 0,
      lanes: [{ id: 'probe', width: LANE_WIDTH }],
    })
    expect(inlineInset(view)).toBe('')
    expect(view.scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('24px')
  })

  it('adds the inset in front of the lanes', () => {
    const view = mountView({ gutterContributions: [lane('probe')], gutterLeadingInset: 12 })

    expect(view.getState().gutterWidth).toBe(LANE_WIDTH + 12)
    expect(view.getState().gutterLayout).toEqual({
      leadingInset: 12,
      fixedWidth: 0,
      lanes: [{ id: 'probe', width: LANE_WIDTH }],
    })
    expect(inlineInset(view)).toBe('12px')
    expect(view.scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('36px')
  })

  it('keeps the inset out of an editor that shows no gutter', () => {
    const view = mountView({ gutterLeadingInset: 12 })

    expect(view.getState().gutterWidth).toBe(0)
    expect(view.getState().gutterLayout.leadingInset).toBe(0)
    expect(inlineInset(view)).toBe('')
  })

  it('changes at runtime and returns to the flush gutter at zero', () => {
    const view = mountView({ gutterContributions: [lane('probe')] })

    expect(view.setGutterLeadingInset(12)).toBe(true)
    expect(view.setGutterLeadingInset(12)).toBe(false)
    expect(view.getState().gutterWidth).toBe(36)
    expect(inlineInset(view)).toBe('12px')

    expect(view.setGutterLeadingInset(0)).toBe(true)
    expect(view.getState().gutterWidth).toBe(LANE_WIDTH)
    expect(view.getState().gutterLayout.leadingInset).toBe(0)
    expect(inlineInset(view)).toBe('')
  })

  it('rounds up to whole pixels and treats unusable values as no inset', () => {
    const view = mountView({ gutterContributions: [lane('probe')], gutterLeadingInset: 11.2 })
    expect(view.getState().gutterLayout.leadingInset).toBe(12)

    view.setGutterLeadingInset(-4)
    expect(view.getState().gutterLayout.leadingInset).toBe(0)
    view.setGutterLeadingInset(Number.NaN)
    expect(view.getState().gutterLayout.leadingInset).toBe(0)
  })

  it('logs the normalized inset applied to the view', () => {
    const log = vi.fn()
    const editor = mountEditor({ plugins: [lanePlugin('probe'), createEditorLoggingPlugin(log)] })
    editor.setGutterLeadingInset(11.2)
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'editor.layout.gutter_leading_inset_changed',
        layout: { gutterLeadingInset: 12 },
      }),
    )
  })

  it('removes the inset when the remaining lane has zero width', () => {
    const view = mountView({
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 12,
    })
    expect(view.getState().gutterWidth).toBe(36)
    view.setGutterContributions([{ ...lane('probe'), width: () => 0 }])
    expect(view.getState().gutterWidth).toBe(0)
    expect(view.getState().gutterLayout.leadingInset).toBe(0)
    expect(inlineInset(view)).toBe('')
    view.setGutterContributions([lane('probe')])
    expect(view.getState().gutterWidth).toBe(36)
    expect(inlineInset(view)).toBe('12px')
  })

  it('only gives the cursor row an inset band while the inset has width', () => {
    const view = mountView({
      cursorLineHighlight: { gutterBackground: true },
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 12,
    })
    view.setSelection(0, 0)
    expect(bandRows(view)).toEqual(['0'])
    view.setGutterLeadingInset(0)
    expect(bandRows(view)).toEqual([])
    view.setGutterLeadingInset(12)
    expect(bandRows(view)).toEqual(['0'])
  })

  it('narrows the wrap width by the inset', () => {
    const flush = mountView({ gutterContributions: [lane('probe')], wrap: true })
    const inset = mountView({
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 16,
      wrap: true,
    })
    for (const view of [flush, inset]) {
      view.setText('abcdefghij'.repeat(4))
      view.setScrollMetrics(0, 100, 104)
    }

    // Reserve one column for the caret so scrollWidth stays within clientWidth.
    // (104 - 24) / 8 - 1 = 9 flush, (104 - 40) / 8 - 1 = 7 with the inset.
    expect(flush.getState().mountedRows[0]?.text).toHaveLength(9)
    expect(inset.getState().mountedRows[0]?.text).toHaveLength(7)
  })

  it('extends the cursor-line band over the inset only when every lane is highlighted', () => {
    const all = mountView({
      cursorLineHighlight: { gutterBackground: true },
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 12,
    })
    const some = mountView({
      cursorLineHighlight: { gutterBackground: ['probe'] },
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 12,
    })
    for (const view of [all, some]) {
      view.setText('one\ntwo')
      view.setScrollMetrics(0, 100, 200)
      view.setSelection(0, 0)
    }

    expect(bandRows(all)).toEqual(['0'])
    expect(bandRows(some)).toEqual([])

    all.setSelection(4, 4)
    expect(bandRows(all)).toEqual(['1'])
  })

  it.each([
    [12, 0],
    [0, 12],
  ])('rejects paint saved at inset %i when the editor uses %i', (savedInset, liveInset) => {
    const saved = mountEditor({ gutterLeadingInset: savedInset })
    saved.openDocument({ documentId: 'file-a', text: 'inset paint' })
    const snapshot = saved.captureSnapshot()
    expect(snapshot).not.toBeNull()
    const mark = vi.spyOn(window.performance, 'mark')

    const restored = mountEditor({ gutterLeadingInset: liveInset, snapshot: snapshot!.paint })

    expect(mark).toHaveBeenCalledWith('editor.snapshot.admission', {
      detail: expect.objectContaining({ reason: 'appearance' }),
    })
    expect(restored.getPresentationState()).toBe('empty')
    const scrollElement =
      container.lastElementChild!.querySelector<HTMLElement>('.editor-virtualized')!
    expect(scrollElement.style.getPropertyValue('--editor-gutter-inset')).toBe(
      liveInset ? `${liveInset}px` : '',
    )
  })

  it('refuses a mismatched inset before changing the view during a direct paint restore', () => {
    const saved = mountEditor({ gutterLeadingInset: 12 })
    saved.openDocument({ documentId: 'file-a', text: 'inset paint' })
    const paint = decodePaintSnapshot(saved.captureSnapshot()!.paint)
    expect(paint).not.toBeNull()
    const view = mountView({ gutterContributions: [lane('probe')] })

    expect(view.restorePaint(paint!)).toBe(false)
    expect(view.isProvisional).toBe(false)
    expect(inlineInset(view)).toBe('')
    expect(view.scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('24px')
  })

  it('keeps the cursor band through repeated provisional paint and live takeover', () => {
    const saved = mountEditor({
      gutterLeadingInset: 12,
      cursorLineHighlight: { gutterBackground: true },
    })
    saved.openDocument({ documentId: 'file-a', text: 'inset paint' })
    const paint = decodePaintSnapshot(saved.captureSnapshot()!.paint)!
    const view = mountView({
      gutterContributions: [lane('probe')],
      gutterLeadingInset: 12,
      cursorLineHighlight: { gutterBackground: true },
    })

    view.setSelection(0, 0)
    expect(view.restorePaint(paint)).toBe(true)
    expect(bandRows(view)).toHaveLength(1)
    expect(view.restorePaint(paint)).toBe(true)
    expect(bandRows(view)).toHaveLength(1)
    view.commitProvisionalPaint()
    expect(bandRows(view)).toEqual(['0'])
    view.setGutterLeadingInset(0)
    expect(bandRows(view)).toEqual([])
  })

  it('saves the inset with the paint and restores it before the live gutter lands', () => {
    const saved = mountEditor({ gutterLeadingInset: 12 })
    saved.openDocument({ documentId: 'file-a', text: 'inset paint' })
    const snapshot = saved.captureSnapshot()
    expect(snapshot).not.toBeNull()
    const paint = decodePaintSnapshot(snapshot!.paint)
    expect(paint?.gutterLayout).toEqual({
      leadingInset: 12,
      fixedWidth: 0,
      lanes: [{ id: 'probe', width: LANE_WIDTH }],
    })
    expect(paint?.gutterWidth).toBe(36)

    const restored = mountEditor({
      documentKey: 'file-a',
      gutterLeadingInset: 12,
      snapshot: snapshot!.paint,
    })
    const scrollElement =
      container.lastElementChild!.querySelector<HTMLElement>('.editor-virtualized')!
    expect(restored.getPresentationState()).toBe('provisional')
    expect(scrollElement.style.getPropertyValue('--editor-gutter-inset')).toBe('12px')

    restored.openDocument({ documentId: 'file-a', text: 'live paint' })
    expect(restored.getPresentationState()).toBe('live')
    expect(scrollElement.style.getPropertyValue('--editor-gutter-inset')).toBe('12px')
    expect(scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('36px')
  })
})

function mountView(
  options: ConstructorParameters<typeof VirtualizedTextView>[1] = {},
): VirtualizedTextView {
  const view = new VirtualizedTextView(container, { textMetrics: TEXT_METRICS, ...options })
  views.push(view)
  view.setText('alpha')
  view.setScrollMetrics(0, 100, 400)
  return view
}

function mountEditor(options: ConstructorParameters<typeof Editor>[1] = {}): Editor {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
  const host = document.createElement('div')
  container.appendChild(host)
  const editor = new Editor(host, {
    documentKey: 'file-a',
    lineHeight: 20,
    plugins: [lanePlugin('probe')],
    textMetrics: TEXT_METRICS,
    ...options,
  })
  editors.push(editor)
  const view: unknown = Reflect.get(editor, 'view')
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 100, 400)
  return editor
}

function lane(id: string): EditorGutterContribution {
  return {
    id,
    snapshotRenderer: { key: id, capture: () => '', restore: () => true },
    createCell: (document) => document.createElement('span'),
    width: () => LANE_WIDTH,
    updateCell: () => undefined,
  }
}

function lanePlugin(id: string): EditorPlugin {
  return { activate: (context) => context.registerGutterContribution(lane(id)) }
}

function inlineInset(view: VirtualizedTextView): string {
  return view.scrollElement.style.getPropertyValue('--editor-gutter-inset')
}

function bandRows(view: VirtualizedTextView): string[] {
  return [
    ...view.scrollElement.querySelectorAll<HTMLElement>(
      '.editor-virtualized-cursor-line-gutter-band',
    ),
  ].map((row) => row.dataset.editorVirtualGutterRow ?? '')
}
