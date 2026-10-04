import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { createInlineMap } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { DisplayProjection } from '../src/virtualization/displayProjection'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'

const releases: (() => void)[] = []
const newText = 'new0\nnew1\nnew2\nnew3\nnew4\nnew5'

afterEach(() => {
  for (const release of releases.splice(0)) release()
  vi.restoreAllMocks()
})

function container(): HTMLDivElement {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px;height:120px'
  document.body.appendChild(host)
  releases.push(() => host.remove())
  return host
}

function projection(view: VirtualizedTextView): DisplayProjection {
  const internal = Reflect.get(view, 'view')
  const value: unknown = internal.model.projection
  if (!(value instanceof DisplayProjection)) throw new TypeError('Expected the view projection')
  return value
}

it.each(['content-height', 'gutter-width', 'gutter-create', 'gutter-update'])(
  'ends row rendering when disposed from %s',
  (site) => {
    const host = container()
    let view: VirtualizedTextView
    let armed = false
    let entries = 0
    let readsAtDisposal = 0
    const cells: HTMLElement[] = []
    const disposedCells = new Map<HTMLElement, number>()
    const viewport = vi.fn()
    const disposeAt = (current: string) => {
      if (!armed || current !== site) return
      armed = false
      entries += 1
      view.dispose()
      readsAtDisposal = reads.mock.calls.length
    }
    const gutter = {
      id: 'lifecycle',
      width: () => {
        disposeAt('gutter-width')
        return 20
      },
      createCell: (document: Document) => {
        disposeAt('gutter-create')
        const cell = document.createElement('div')
        cells.push(cell)
        return cell
      },
      updateCell: () => disposeAt('gutter-update'),
      disposeCell: (cell: HTMLElement) => {
        disposedCells.set(cell, (disposedCells.get(cell) ?? 0) + 1)
      },
    }
    view = new VirtualizedTextView(host, {
      rowHeight: 20,
      overscan: 0,
      gutterContributions: site.startsWith('gutter-') ? [gutter] : [],
      onContentHeightChange: () => disposeAt('content-height'),
      onViewportChange: viewport,
    })
    releases.push(() => view.dispose())
    view.setText('old0\nold1')
    view.setScrollMetrics(0, 120, 400)
    const reads = vi.spyOn(projection(view), 'getRow')
    viewport.mockClear()
    armed = true

    expect(() => view.runAtomicRender(() => view.setText(newText))).not.toThrow()

    expect(entries).toBe(1)
    expect(reads.mock.calls.length).toBe(readsAtDisposal)
    expect(view.getState().mountedRows).toEqual([])
    expect(host.contains(view.scrollElement)).toBe(false)
    expect(Reflect.get(view, 'cancelContentWidthMeasurement')).toBeNull()
    expect(view.isRenderingAtomically).toBe(false)
    expect(viewport).not.toHaveBeenCalled()
    view.dispose()
    expect(cells.every((cell) => disposedCells.get(cell) === 1)).toBe(true)
  },
)

it('completes a live atomic render before ordinary disposal', () => {
  const host = container()
  const viewport = vi.fn()
  const view = new VirtualizedTextView(host, {
    rowHeight: 20,
    overscan: 0,
    onViewportChange: () => viewport(view.isRenderingAtomically),
  })
  releases.push(() => view.dispose())
  view.setText('old0\nold1')
  view.setScrollMetrics(0, 120, 400)
  viewport.mockClear()

  view.runAtomicRender(() => view.setText(newText))

  expect(viewport.mock.calls).toEqual([[false]])
  expect(view.getState().mountedRows.map((row) => row.element.textContent)).toEqual(
    newText.split('\n'),
  )
  expect(view.isRenderingAtomically).toBe(false)
  view.dispose()
  expect(view.getState().mountedRows).toEqual([])
  expect(Reflect.get(view, 'cancelContentWidthMeasurement')).toBeNull()
})

it('ends Editor height notifications and contribution delivery at disposal', () => {
  const host = container()
  const updates = vi.fn()
  const disposed = vi.fn()
  const editor = new Editor(host, {
    plugins: [
      {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              inputs: ['viewport'],
              update: updates,
              dispose: disposed,
            }),
          }),
      },
    ],
  })
  releases.push(() => editor.dispose())
  const view: unknown = Reflect.get(editor, 'view')
  if (!(view instanceof VirtualizedTextView)) throw new TypeError('Expected the editor view')
  view.setScrollMetrics(0, 120, 400)
  editor.setText('old0\nold1')
  updates.mockClear()
  const errors = vi.spyOn(console, 'error')
  editor.onDidChangeContentHeight(() => editor.dispose())
  const later = vi.fn()
  editor.onDidChangeContentHeight(later)

  editor.setContent(newText)

  expect(later).not.toHaveBeenCalled()
  expect(errors).not.toHaveBeenCalled()
  expect(updates).not.toHaveBeenCalled()
  expect(disposed).toHaveBeenCalledOnce()
  expect(view.isRenderingAtomically).toBe(false)
  expect(view.getState().mountedRows).toEqual([])
})

it('ends a same-line gutter update before changing the disposed row', () => {
  const host = container()
  let armed = false
  const cleanup = vi.fn()
  const view = new VirtualizedTextView(host, {
    rowHeight: 20,
    overscan: 0,
    gutterContributions: [
      {
        id: 'lifecycle',
        width: () => 20,
        createCell: (document) => document.createElement('div'),
        updateCell: () => {
          if (!armed) return
          armed = false
          view.dispose()
        },
        disposeCell: cleanup,
      },
    ],
  })
  releases.push(() => view.dispose())
  view.setText('old0\nold1')
  view.setScrollMetrics(0, 120, 400)
  const row = view.getState().mountedRows[0]!
  const before = row.element.textContent
  armed = true

  view.applyEdit({ from: 0, to: 0, text: '!' }, '!old0\nold1')

  expect(row.element.textContent).toBe(before)
  expect(view.getState().mountedRows).toEqual([])
  expect(cleanup).toHaveBeenCalledTimes(2)
  expect(view.isRenderingAtomically).toBe(false)
})

it.each([false, true])(
  'releases a returned inline widget once when disposal inside render is %s',
  (disposeInside) => {
    const host = container()
    const view = new VirtualizedTextView(host, { rowHeight: 20, overscan: 0 })
    releases.push(() => view.dispose())
    const text = 'a ![img](x.png) b\nplain'
    view.setText(text)
    view.setScrollMetrics(0, 120, 400)
    const row = view.getState().mountedRows[0]!.element
    const returned: HTMLElement[] = []
    let terminalText: string | null = null
    const cleanup = vi.fn()
    const render = vi.fn((element: HTMLElement) => {
      returned.push(element)
      element.appendChild(document.createElement('img'))
      if (disposeInside) {
        view.dispose()
        terminalText = row.textContent
      }
      return { dispose: cleanup }
    })

    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'image',
          startIndex: 2,
          endIndex: 15,
          text: 'IMG',
          render,
        },
      ]),
    )

    expect(cleanup).toHaveBeenCalledTimes(disposeInside ? 1 : 0)
    view.dispose()
    view.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledOnce()
    expect(returned).toHaveLength(1)
    expect(returned[0]?.parentNode).toBeNull()
    if (disposeInside) expect(row.textContent).toBe(terminalText)
    expect(view.getState().mountedRows).toEqual([])
    expect(Reflect.get(view, 'cancelContentWidthMeasurement')).toBeNull()
    expect(view.isRenderingAtomically).toBe(false)
  },
)

it.each([false, true])('finishes terminal teardown when a cell cleanup throws is %s', (throws) => {
  const host = container()
  const failure = new TypeError('external cleanup failure')
  let armed = false
  const cleanup = vi.fn(() => {
    if (!armed) return
    armed = false
    throw failure
  })
  const view = new VirtualizedTextView(host, {
    rowHeight: 20,
    overscan: 0,
    gutterContributions: [
      {
        id: 'lifecycle',
        width: () => 20,
        createCell: (document) => document.createElement('div'),
        updateCell: () => undefined,
        disposeCell: cleanup,
      },
    ],
  })
  releases.push(() => view.dispose())
  view.setText('old0\nold1')
  view.setScrollMetrics(0, 120, 400)
  expect(view.getState().mountedRows).toHaveLength(2)
  armed = throws

  const observed: unknown[] = []
  try {
    view.dispose()
  } catch (error) {
    observed.push(error)
  }
  expect(observed).toHaveLength(throws ? 1 : 0)
  if (throws) expect(observed[0]).toBe(failure)

  expect(cleanup).toHaveBeenCalledTimes(2)
  expect(view.getState().mountedRows).toEqual([])
  expect(host.contains(view.scrollElement)).toBe(false)
  view.dispose()
  expect(cleanup).toHaveBeenCalledTimes(2)
})

it.each([false, true])(
  'detaches retiring widget ownership before terminal cleanup is %s',
  (disposeOnRetire) => {
    const host = container()
    const view = new VirtualizedTextView(host, { rowHeight: 20, overscan: 0 })
    releases.push(() => view.dispose())
    const text = 'a ![img](x.png) b ![other](y.png) c\nplain'
    const snapshot = createPieceTableSnapshot(text)
    view.setText(text)
    view.setScrollMetrics(0, 120, 400)
    let armed = false
    const retired = vi.fn(() => {
      if (armed) view.dispose()
    })
    const survivor = vi.fn()
    const other = {
      id: 'other',
      startIndex: text.indexOf('![other]'),
      endIndex: text.indexOf('![other]') + '![other](y.png)'.length,
      text: 'OTHER',
      render: () => ({ dispose: survivor }),
    }
    view.setInlineMap(
      createInlineMap(snapshot, [
        {
          id: 'image',
          startIndex: 2,
          endIndex: 15,
          text: 'IMG',
          render: () => ({ dispose: retired }),
        },
        other,
      ]),
    )
    armed = disposeOnRetire

    view.setInlineMap(createInlineMap(snapshot, [other]))

    expect(retired).toHaveBeenCalledOnce()
    expect(survivor).toHaveBeenCalledTimes(disposeOnRetire ? 1 : 0)
    view.dispose()
    view.dispose()
    expect(retired).toHaveBeenCalledOnce()
    expect(survivor).toHaveBeenCalledOnce()
    expect(view.getState().mountedRows).toEqual([])
    expect(view.isRenderingAtomically).toBe(false)
  },
)

it.each([false, true])(
  'preserves gutter cleanup owners when widget release changes contributions is %s',
  (changesOwners) => {
    const host = container()
    const cleanup = vi.fn()
    const view = new VirtualizedTextView(host, {
      rowHeight: 20,
      overscan: 0,
      gutterContributions: [
        {
          id: 'lifecycle',
          width: () => 20,
          createCell: (document) => document.createElement('div'),
          updateCell: () => undefined,
          disposeCell: cleanup,
        },
      ],
    })
    releases.push(() => view.dispose())
    const text = 'a ![img](x.png) b\nplain'
    view.setText(text)
    view.setScrollMetrics(0, 120, 400)
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'image',
          startIndex: 2,
          endIndex: 15,
          text: 'IMG',
          render: () => ({
            dispose: () => {
              if (changesOwners) view.setGutterContributions([])
            },
          }),
        },
      ]),
    )

    view.dispose()

    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(view.getState().mountedRows).toEqual([])
    expect(host.contains(view.scrollElement)).toBe(false)
  },
)
