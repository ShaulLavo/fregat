import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualizedTextView } from '../src/virtualization'
import type { SavedPaint } from '../src/editor/paintSnapshot'
import '../src/style.css'
import { Editor } from '../src/editor'
import type { EditorViewContributionContext } from '../src/plugins'

it('invalidates a row presentation before replacing its text and when disposed', () => {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:400px;height:180px'
  document.body.append(host)
  let context: EditorViewContributionContext | null = null
  const editor = new Editor(host, {
    plugins: [
      {
        name: 'presentation-test',
        activate: (api) =>
          api.registerViewContribution({
            createContribution: (view) => {
              context = view
              return { update() {}, dispose() {} }
            },
          }),
      },
    ],
  })
  const view = (): EditorViewContributionContext => {
    if (!context) throw new Error('No view')
    return context
  }
  editor.setText('first')
  const handle = view().getRowPresentation(0)!
  let textAtInvalidation = ''
  let reentrant: unknown = 'not-called'
  handle.signal.addEventListener('abort', () => {
    textAtInvalidation = handle.element.textContent ?? ''
    reentrant = view().getRowPresentation(0)
  })
  editor.setText(Array.from({ length: 1000 }, (_, index) => `second ${index}`).join('\n'))
  expect(handle.signal.aborted).toBe(true)
  expect(reentrant).toBeNull()
  expect(textAtInvalidation).toContain('first')
  const scrolling = view().getRowPresentation(0)!
  let beforeRecycle = ''
  scrolling.signal.addEventListener('abort', () => {
    beforeRecycle = scrolling.element.textContent ?? ''
  })
  editor.setScrollPosition({ top: 12000 })
  expect(scrolling.signal.aborted).toBe(true)
  expect(beforeRecycle).toContain('second 0')
  const visible = view().getSnapshot().visibleRows[0]!
  const next = view().getRowPresentation(visible.index)!
  editor.dispose()
  expect(next.signal.aborted).toBe(true)
  host.remove()
})

describe('row presentation lifetime', () => {
  let host: HTMLDivElement
  let view: VirtualizedTextView

  beforeEach(() => {
    host = document.createElement('div')
    host.style.cssText = 'width:400px;height:100px'
    document.body.append(host)
    view = new VirtualizedTextView(host, { rowHeight: 20, overscan: 0 })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 60, 400)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    view.dispose()
    host.remove()
  })

  it('releases a handle without reporting row invalidation', () => {
    const released = view.getRowPresentation(0)!
    const retained = view.getRowPresentation(0)!
    const onAbort = vi.fn()
    released.signal.addEventListener('abort', onAbort)
    released.dispose()
    released.dispose()
    expect(released.signal.aborted).toBe(false)
    view.setText('replacement')
    expect(retained.signal.aborted).toBe(true)
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('aborts before disposal detaches the row or clears its model', () => {
    const handle = view.getRowPresentation(0)!
    let connected = false
    let lineCount = 0
    handle.signal.addEventListener('abort', () => {
      connected = handle.element.isConnected
      lineCount = view.getState().lineCount
    })
    view.dispose()
    expect(handle.signal.aborted).toBe(true)
    expect(connected).toBe(true)
    expect(lineCount).toBe(3)
  })

  it('invalidates only the edited row during a same-line patch, before changing text', () => {
    const edited = view.getRowPresentation(0)!
    const unchanged = view.getRowPresentation(1)!
    let before = ''
    let during: unknown = 'not-called'
    edited.signal.addEventListener('abort', () => {
      before = edited.element.textContent ?? ''
      during = view.getRowPresentation(0)
    })
    const patch = vi.spyOn(view.getState().mountedRows[0]!.textNode, 'replaceData')
    view.applyEdit({ from: 1, to: 1, text: 'X' }, 'aXlpha\nbeta\ngamma')
    expect(patch).toHaveBeenCalledWith(1, 0, 'X')
    expect(edited.signal.aborted).toBe(true)
    expect(before).toBe('alpha')
    expect(during).toBeNull()
    expect(unchanged.signal.aborted).toBe(false)
    expect(view.getRowPresentation(0)).not.toBeNull()
  })

  it('retains handles when only row decorations change', () => {
    const handle = view.getRowPresentation(0)!
    view.setRowDecorations(new Map([[0, { className: 'owner-decoration' }]]))
    expect(handle.element.classList.contains('owner-decoration')).toBe(true)
    expect(handle.signal.aborted).toBe(false)
  })

  it('retains handles when only row position changes', () => {
    const handle = view.getRowPresentation(1)!
    view.setRowGap(3)
    expect(view.getState().mountedRows.find((row) => row.index === 1)?.top).toBe(23)
    expect(handle.signal.aborted).toBe(false)
  })

  it('retains handles when only the horizontal chunk window changes', () => {
    view.setText('x'.repeat(20_000))
    view.setScrollMetrics(0, 20, 200, 0)
    const handle = view.getRowPresentation(0)!
    const before = view.getState().mountedRows[0]!.chunkKey
    view.setScrollMetrics(0, 20, 200, 80000)
    expect(view.getState().mountedRows[0]!.chunkKey).not.toBe(before)
    expect(handle.signal.aborted).toBe(false)
  })

  it('allows acquisition after a failed row replacement and retries the paint', () => {
    const handle = view.getRowPresentation(0)!
    const row = view.getState().mountedRows[0]!
    vi.spyOn(row.textNode, 'data', 'set').mockImplementationOnce(() => {
      throw new Error('replacement failed')
    })
    expect(() => view.setText('new text\nbeta\ngamma')).toThrow('replacement failed')
    expect(handle.signal.aborted).toBe(true)
    expect(view.getRowPresentation(0)).not.toBeNull()
    view.setRowDecorations(new Map())
    expect(view.getRowPresentation(0)?.element.textContent).toBe('new text')
  })

  it('allows acquisition after a failed same-line patch and retries the paint', () => {
    const handle = view.getRowPresentation(0)!
    const row = view.getState().mountedRows[0]!
    vi.spyOn(row.textNode, 'replaceData').mockImplementationOnce(() => {
      throw new Error('patch failed')
    })
    expect(() => view.applyEdit({ from: 1, to: 1, text: 'X' }, 'aXlpha\nbeta\ngamma')).toThrow(
      'patch failed',
    )
    expect(handle.signal.aborted).toBe(true)
    expect(view.getRowPresentation(0)).not.toBeNull()
    view.setRowDecorations(new Map())
    expect(view.getRowPresentation(0)?.element.textContent).toBe('aXlpha')
  })

  it('reacquires rows pooled by provisional paint even when no provisional slot consumed them', () => {
    view.setText('alpha')
    view.setScrollMetrics(0, 20, 400)
    const handle = view.getRowPresentation(0)!
    let before = ''
    let connected = false
    handle.signal.addEventListener('abort', () => {
      before = handle.element.textContent ?? ''
      connected = handle.element.isConnected
    })
    const paint: SavedPaint = {
      format: 5,
      appearance: '',
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 400,
      reservedLeft: 0,
      reservedRight: 0,
      viewportWidth: 400,
      viewportHeight: 20,
      boxWidth: 400,
      boxHeight: 20,
      gutterWidth: 0,
      gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
      rows: [],
      layers: [],
    }
    expect(view.restorePaint(paint)).toBe(true)
    expect(handle.signal.aborted).toBe(true)
    expect(before).toBe('alpha')
    expect(connected).toBe(true)
    expect(view.getRowPresentation(0)).toBeNull()
    view.commitProvisionalPaint()
    const restored = view.getRowPresentation(0)
    expect(restored).not.toBeNull()
    expect(restored?.element).toBe(handle.element)
    expect(restored?.element.dataset.editorVirtualRow).toBe('0')
    expect(restored?.element.textContent).toBe('alpha')
  })

  it('reacquires a retired row when the viewport returns to the same index', () => {
    const handle = view.getRowPresentation(0)!
    view.setScrollMetrics(0, 0, 0)
    expect(handle.signal.aborted).toBe(true)
    view.setScrollMetrics(0, 20, 400)
    expect(view.getRowPresentation(0)).not.toBeNull()
    expect(view.getRowPresentation(0)?.element.textContent).toBe('alpha')
  })
})
