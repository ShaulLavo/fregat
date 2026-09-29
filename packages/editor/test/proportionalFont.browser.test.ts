import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'
import { Editor } from '../src/editor'
import type { EditorLogEvent, EditorPlugin } from '../src/public/extensions'
import { VirtualizedTextView } from '../src/virtualization'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'

// Narrow and wide glyphs side by side: in a proportional face their advances differ by a factor of
// three or more, so column arithmetic drifts by whole characters within a few columns.
const LINE = 'iiii WWWW llll mmmm .... 0000 ||||'

function rangeReads(run: () => void): number {
  const rects = Range.prototype.getClientRects
  const bounding = Range.prototype.getBoundingClientRect
  let reads = 0
  Range.prototype.getClientRects = function getClientRects(this: Range) {
    reads += 1
    return rects.call(this)
  }
  Range.prototype.getBoundingClientRect = function getBoundingClientRect(this: Range) {
    reads += 1
    return bounding.call(this)
  }
  try {
    run()
  } finally {
    Range.prototype.getClientRects = rects
    Range.prototype.getBoundingClientRect = bounding
  }
  return reads
}

describe('font advances', () => {
  let host: HTMLDivElement
  let style: HTMLStyleElement
  let view: VirtualizedTextView | null = null

  function open(fontFamily: string): HTMLElement {
    style.textContent = `.font-under-test * { font-family: ${fontFamily} !important; }`
    clearBrowserTextMetricsCache()
    view = new VirtualizedTextView(host, { rowHeight: 20 })
    view.setScrollMetrics(0, 160, 600)
    view.setText(LINE)
    return view.getState().mountedRows[0]!.element
  }

  /** The column the view reports under the left edge of each character, read from the DOM. */
  function hitColumns(row: HTMLElement): { expected: number[]; actual: number[] } {
    const node = Array.from(row.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!
    const rowRect = row.getBoundingClientRect()
    const range = document.createRange()
    const expected: number[] = []
    const actual: number[] = []
    for (let column = 0; column < LINE.length; column++) {
      range.setStart(node, column)
      range.setEnd(node, column + 1)
      const hit = view!.rowAtPoint(range.getBoundingClientRect().left + 1, rowRect.top + 10)
      expected.push(column)
      actual.push(hit?.offset ?? -1)
    }
    return { expected, actual }
  }

  beforeEach(() => {
    style = document.createElement('style')
    document.head.append(style)
    host = document.createElement('div')
    host.className = 'font-under-test'
    host.style.cssText = 'width: 600px; height: 160px'
    document.body.append(host)
  })

  afterEach(() => {
    view?.dispose()
    view = null
    host.remove()
    style.remove()
    clearBrowserTextMetricsCache()
  })

  it('hit-tests every column of a proportional font where the glyph is drawn', () => {
    const { expected, actual } = hitColumns(open('sans-serif'))
    expect(actual).toEqual(expected)
  })

  it('keeps monospace rows on arithmetic geometry, with no range reads', () => {
    const row = open('monospace')
    let result: ReturnType<typeof hitColumns> | null = null
    const reads = rangeReads(() => {
      const rowRect = row.getBoundingClientRect()
      for (let x = 2; x < 200; x += 7) view!.rowAtPoint(rowRect.left + x, rowRect.top + 10)
    })
    result = hitColumns(row)
    expect(reads).toBe(0)
    expect(result.actual).toEqual(result.expected)
  })
})

describe('a font change on a mounted editor', () => {
  let host: HTMLDivElement
  let style: HTMLStyleElement
  let editor: Editor
  let remeasured = 0

  const remeasureLog: EditorPlugin = {
    activate: (context) =>
      context.registerLogger((event: EditorLogEvent) => {
        if (event.action === 'editor.layout.text_metrics_remeasured') remeasured += 1
      }) ?? [],
  }

  function setFont(fontFamily: string) {
    style.textContent = `.font-under-test * { font-family: ${fontFamily} !important; }`
  }

  // The face observer reports after layout; two frames put both the report and the re-render behind us.
  const frames = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )

  function wrongColumns(): number[] {
    const row = host.querySelector<HTMLElement>('.editor-virtualized-row')!
    const node = Array.from(row.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!
    const rowRect = row.getBoundingClientRect()
    const range = document.createRange()
    const wrong: number[] = []
    for (let column = 0; column < LINE.length; column++) {
      range.setStart(node, column)
      range.setEnd(node, column + 1)
      const hit = editor.rowAtPoint(range.getBoundingClientRect().left + 1, rowRect.top + 10)
      if (hit?.offset !== column) wrong.push(column)
    }
    return wrong
  }

  beforeEach(async () => {
    remeasured = 0
    style = document.createElement('style')
    document.head.append(style)
    setFont('monospace')
    host = document.createElement('div')
    host.className = 'font-under-test'
    host.style.cssText = 'width: 600px; height: 160px; display: flex'
    document.body.append(host)
    clearBrowserTextMetricsCache()
    editor = new Editor(host, { defaultText: LINE, plugins: [remeasureLog] })
    await frames()
  })

  afterEach(() => {
    editor.dispose()
    host.remove()
    style.remove()
    clearBrowserTextMetricsCache()
  })

  it('re-measures when the host swaps the font with nothing loading', async () => {
    setFont('sans-serif')
    await frames()
    expect(wrongColumns()).toEqual([])

    setFont('monospace')
    await frames()
    expect(wrongColumns()).toEqual([])
    expect(remeasured).toBe(2)
  })

  it('re-measures when a face the font names finishes loading after mount', async () => {
    // Until the face loads, the stack falls back to monospace and the first reading is right for it.
    setFont("'Late Proportional', monospace")
    await frames()
    const face = new FontFace(
      'Late Proportional',
      'local("Liberation Sans"), local("DejaVu Sans"), local("Noto Sans"), local("Arial")',
    )
    document.fonts.add(await face.load())
    await frames()

    expect(remeasured).toBeGreaterThan(0)
    expect(wrongColumns()).toEqual([])
    document.fonts.delete(face)
  })

  it('re-measures when a face lands between the first reading and the first frame', async () => {
    editor.dispose()
    host.replaceChildren()
    setFont("'Early Proportional', monospace")
    const face = new FontFace(
      'Early Proportional',
      'local("Liberation Sans"), local("DejaVu Sans"), local("Noto Sans"), local("Arial")',
    )
    await face.load()
    clearBrowserTextMetricsCache()
    // Built while the face is not yet in the document, so the reading is the monospace fallback;
    // the face is in before anything is painted, so the observer's first sighting is already it.
    editor = new Editor(host, { defaultText: LINE, plugins: [remeasureLog] })
    document.fonts.add(face)
    await frames()

    expect(wrongColumns()).toEqual([])
    document.fonts.delete(face)
  })

  it('re-measures every editor a shared font change reaches', async () => {
    const second = document.createElement('div')
    second.style.cssText = 'width: 600px; height: 160px; display: flex'
    host.after(second)
    second.className = 'font-under-test'
    const other = new Editor(second, { defaultText: LINE, plugins: [remeasureLog] })
    await frames()
    remeasured = 0

    setFont('sans-serif')
    await frames()

    expect(remeasured).toBe(2)
    expect(wrongColumns()).toEqual([])
    other.dispose()
    second.remove()
  })

  it('does not re-measure for being hidden and shown again', async () => {
    host.style.display = 'none'
    await frames()
    host.style.display = 'flex'
    await frames()

    expect(remeasured).toBe(0)
    expect(wrongColumns()).toEqual([])
  })
})
