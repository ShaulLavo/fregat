import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Editor } from '../src/editor/Editor'
import { createVisibleEditor } from './factories/visibleEditor'
import { createInlineMap, type InlineReplacementSpec } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { resetEditorInstanceCount } from '../src/public/testing'
import { VirtualizedTextView } from '../src/virtualization'
import { offsetToX } from '../src/virtualization/virtualizedTextViewGeometry'
import { rowOffsetForLocalIndex } from '../src/virtualization/virtualizedTextViewInlineMapping'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'
import type { MountedVirtualizedTextRow } from '../src/virtualization/virtualizedTextViewTypes'

const CHARACTER_WIDTH = 7.2266
const ROW_HEIGHT = 20
/** Nothing like a whole number of cells, so a width taken from the placeholder cannot pass for it. */
const WIDGET_WIDTH = 61.5
const IMAGE_LINE = 'a ![img](x.png) b'
/** The markup, replaced by three placeholder columns: `a IMG b`. */
const IMAGE_START = 2
const IMAGE_END = 15
const PLACEHOLDER = 'IMG'

type WidgetMount = {
  renders: number
  disposals: number
  readonly containers: HTMLElement[]
}

function createMount(): WidgetMount {
  return { renders: 0, disposals: 0, containers: [] }
}

function sizedRender(mount: WidgetMount, width = WIDGET_WIDTH) {
  return (container: HTMLElement) => {
    mount.renders += 1
    mount.containers.push(container)
    container.append(container.ownerDocument.createElement('img'))
    sizeElement(container, width)
    return {
      dispose: () => {
        mount.disposals += 1
      },
    }
  }
}

/** happy-dom answers every rect empty, which is exactly the state an unmeasured widget is in. */
function sizeElement(element: HTMLElement, width: number): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: 16,
      height: 16,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

function imageSpec(mount: WidgetMount, width = WIDGET_WIDTH): InlineReplacementSpec {
  return {
    id: 'image',
    startIndex: IMAGE_START,
    endIndex: IMAGE_END,
    text: PLACEHOLDER,
    render: sizedRender(mount, width),
  }
}

function internals(view: VirtualizedTextView): VirtualizedTextViewInternal {
  return Reflect.get(view, 'view') as VirtualizedTextViewInternal
}

function mountView(container: HTMLElement, text: string, viewportRows = 40): VirtualizedTextView {
  const view = new VirtualizedTextView(container, {
    rowHeight: ROW_HEIGHT,
    overscan: 0,
    textMetrics: { characterWidth: CHARACTER_WIDTH, rowHeight: ROW_HEIGHT },
  })
  view.setText(text)
  view.setScrollMetrics(0, ROW_HEIGHT * viewportRows, 4_000)
  return view
}

function applyReplacements(
  view: VirtualizedTextView,
  text: string,
  specs: readonly InlineReplacementSpec[],
): void {
  view.setInlineMap(createInlineMap(createPieceTableSnapshot(text), specs))
}

function rowForIndex(view: VirtualizedTextView, index: number): MountedVirtualizedTextRow {
  const row = view.getState().mountedRows.find((candidate) => candidate.index === index)
  if (!row) throw new Error(`row ${index} is not mounted`)
  return row
}

function widgetElement(row: MountedVirtualizedTextRow): HTMLElement {
  const element = row.element.querySelector('.editor-inline-widget')
  if (!(element instanceof HTMLElement)) throw new Error('no widget mounted in row')
  return element
}

type StubbedResizeObserver = { readonly callback: () => void; readonly targets: Element[] }

/** Hands back the observers the view creates, so a test can deliver a resize on its own terms. */
function stubResizeObservers(): readonly StubbedResizeObserver[] {
  const observers: StubbedResizeObserver[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly entry: StubbedResizeObserver

      constructor(callback: () => void) {
        this.entry = { callback, targets: [] }
        observers.push(this.entry)
      }

      observe(target: Element): void {
        this.entry.targets.push(target)
      }

      unobserve(): void {}

      disconnect(): void {}
    },
  )

  return observers
}

function caretX(container: HTMLElement): number {
  const caret = container.querySelector('.editor-virtualized-caret')
  if (!(caret instanceof HTMLElement)) throw new Error('no caret painted')
  return Number.parseFloat(caret.style.transform.replace(/^translate\(/, ''))
}

/** Long enough for the repaint a settled replacement asks for, which leaves the frame first. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

/** The advance the row gives the replacement, read at the two boundaries it painted. */
function widgetAdvance(view: VirtualizedTextView, row: MountedVirtualizedTextRow): number {
  const internal = internals(view)
  const start = rowOffsetForLocalIndex(row, IMAGE_START)
  const end = rowOffsetForLocalIndex(row, IMAGE_START + PLACEHOLDER.length)
  expect([start, end]).toEqual([IMAGE_START, IMAGE_END])
  return offsetToX(internal, row, end) - offsetToX(internal, row, start)
}

describe('inline replacements that render their own DOM', () => {
  let container: HTMLElement
  let view: VirtualizedTextView | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    view?.dispose()
    view = null
    container.remove()
    vi.unstubAllGlobals()
  })

  it('mounts the rendered node in place of the replaced text', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    const row = rowForIndex(view, 0)
    const widget = widgetElement(row)

    expect(row.text).toBe('a IMG b')
    expect(mount.renders).toBe(1)
    expect(widget.querySelector('img')).not.toBeNull()
    expect(widget.getAttribute('contenteditable')).toBe('false')
    expect(row.element.textContent).toBe('a  b')
  })

  it('dresses the mount in the run class, and re-dresses it when the run changes class', () => {
    const mount = createMount()
    const text = `${IMAGE_LINE}\nplain`
    view = mountView(container, text)
    applyReplacements(view, text, [{ ...imageSpec(mount), className: 'editor-image-widget' }])

    const widget = widgetElement(rowForIndex(view, 0))
    expect(widget.classList.contains('editor-image-widget')).toBe(true)

    applyReplacements(view, text, [{ ...imageSpec(mount), className: 'editor-broken-image' }])

    expect(mount.renders).toBe(1)
    expect(widget.classList.contains('editor-image-widget')).toBe(false)
    expect(widget.classList.contains('editor-broken-image')).toBe(true)
  })

  it('spaces the columns after the replacement by the measured node, not by the placeholder', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    // What the three placeholder columns would have advanced, had the node not been measured.
    expect(PLACEHOLDER.length * CHARACTER_WIDTH).toBeLessThan(WIDGET_WIDTH - 1)
    expect(widgetAdvance(view, rowForIndex(view, 0))).toBeCloseTo(WIDGET_WIDTH, 6)
  })

  it('re-spaces the row when the mounted node changes size after it was measured', () => {
    const observers = stubResizeObservers()
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    const row = rowForIndex(view, 0)
    const widget = widgetElement(row)
    expect(widgetAdvance(view, row)).toBeCloseTo(WIDGET_WIDTH, 6)
    expect(observers.flatMap((observer) => observer.targets)).toContain(widget)

    sizeElement(widget, 140)
    for (const observer of observers) {
      if (observer.targets.includes(widget)) observer.callback()
    }

    expect(widgetAdvance(view, row)).toBeCloseTo(140, 6)
  })

  /**
   * Every other place that drops the row caches is inside a pass that goes on to repaint. A
   * replacement settling on its size is reached from a resize delivery with nothing behind it, so
   * without a pass of its own the caret keeps the pixels it was last painted at until the next
   * keystroke happens to move it.
   */
  it('repaints what is positioned in pixels when the mounted node changes size', async () => {
    const observers = stubResizeObservers()
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])
    view.focusInput()
    // Past the replacement rather than inside it, which would reveal the source text and unmount it.
    view.setSelection(IMAGE_LINE.length, IMAGE_LINE.length)

    const widget = widgetElement(rowForIndex(view, 0))
    const before = caretX(container)

    sizeElement(widget, WIDGET_WIDTH + 200)
    for (const observer of observers) {
      if (observer.targets.includes(widget)) observer.callback()
    }
    await settle()

    expect(caretX(container) - before).toBeCloseTo(200, 6)
  })

  it('resolves a boundary the browser found inside the node to the replaced span', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    const row = rowForIndex(view, 0)
    const image = widgetElement(row).querySelector('img')!

    expect(view.textOffsetFromDomBoundary(image, 0)).toBe(IMAGE_START)
    expect(view.textOffsetFromDomBoundary(widgetElement(row), 1)).toBe(IMAGE_END)
  })

  it('keeps one mount across a scroll that recycles the row it is painted into', () => {
    const mount = createMount()
    const text = [IMAGE_LINE, ...Array.from({ length: 400 }, (_, index) => `line ${index}`)].join(
      '\n',
    )
    view = mountView(container, text, 5)
    applyReplacements(view, text, [imageSpec(mount)])

    const mounted = widgetElement(rowForIndex(view, 0))
    const pooled = internals(view).rowPool.length

    view.setScrollMetrics(ROW_HEIGHT * 300, ROW_HEIGHT * 5, 4_000)

    expect(view.getState().mountedRows.map((row) => row.index)).not.toContain(0)
    // The virtualizer really handed the row back rather than growing the window.
    expect(internals(view).rowPool.length).toBeGreaterThanOrEqual(pooled)

    view.setScrollMetrics(0, ROW_HEIGHT * 5, 4_000)

    expect(mount.renders).toBe(1)
    expect(mount.disposals).toBe(0)
    expect(widgetElement(rowForIndex(view, 0))).toBe(mounted)
  })

  it('leaves a replacement the wrap boundary cuts in two as the text it stands for', () => {
    const mount = createMount()
    // One unbreakable token, so the wrap has to fall in the middle of it rather than on a space.
    const line = `${'x'.repeat(23)}![img](x.png)${'y'.repeat(5)}`
    view = mountView(container, line)
    view.setWrapEnabled(true)
    view.setScrollMetrics(0, ROW_HEIGHT * 40, 24 * CHARACTER_WIDTH)
    applyReplacements(view, line, [
      { ...imageSpec(mount), startIndex: line.indexOf('!['), endIndex: line.lastIndexOf(')') + 1 },
    ])

    const rows = view.getState().mountedRows
    // The wrap really split the line, so the run had a boundary to fall across.
    expect(rows.length).toBeGreaterThan(1)
    expect(container.querySelector('.editor-inline-widget')).toBeNull()
    expect(mount.renders).toBe(0)
    expect(rows.map((row) => row.text).join('')).toContain(PLACEHOLDER)
  })

  it('repaints a widget row without rebuilding the nodes standing around the mount', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    const row = rowForIndex(view, 0)
    const painted = [...row.element.childNodes]
    view.setRowDecorations(new Map([[0, { className: 'marked' }]]))

    const repainted = [...row.element.childNodes]

    expect(row.element.classList.contains('marked')).toBe(true)
    expect(repainted).toHaveLength(painted.length)
    // Identity, not shape: a rebuild produces nodes that read the same and lay out from scratch.
    for (const [index, node] of repainted.entries()) expect(node).toBe(painted[index])
  })

  it('takes the mount down when its replacement leaves the map', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    const mounted = widgetElement(rowForIndex(view, 0))
    view.setInlineMap(null)

    expect(mount.disposals).toBe(1)
    expect(mounted.isConnected).toBe(false)
    expect(rowForIndex(view, 0).element.textContent).toBe(IMAGE_LINE)
  })

  it('disposes what it mounted when the view goes away', () => {
    const mount = createMount()
    view = mountView(container, `${IMAGE_LINE}\nplain`)
    applyReplacements(view, `${IMAGE_LINE}\nplain`, [imageSpec(mount)])

    view.dispose()
    view = null

    expect(mount.disposals).toBe(1)
  })
})

describe('inline replacements that render their own DOM, through the editor', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {})
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('renders a node a replacement provider supplied, over an unchanged document', async () => {
    const text = `${IMAGE_LINE}\nplain\n`
    const mount = createMount()
    editor.openDocument({ documentId: 'x.md', languageId: 'markdown', text })
    await flush()
    editor.setInlineReplacementProvider(() => [imageSpec(mount)])
    await flush()

    const widget = container.querySelector('.editor-inline-widget')

    expect(mount.renders).toBe(1)
    expect(widget?.querySelector('img')).not.toBeNull()
    expect(editor.materializeFullText()).toBe(text)
  })
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180))
  await Promise.resolve()
  await Promise.resolve()
}
