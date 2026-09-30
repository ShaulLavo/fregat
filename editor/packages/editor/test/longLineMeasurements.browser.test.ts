import { afterEach, describe, expect, it, vi } from 'vitest'
import '../src/style.css'

import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type DocumentSessionChange,
} from '../src/documentSession'
import { VirtualizedTextView } from '../src/virtualization'
import {
  estimatedDisplayCellForColumn,
  offsetToX,
  xToOffset,
} from '../src/virtualization/virtualizedTextViewGeometry'
import { createInlineMap } from '../src/inlineMap'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'

const mounted: { host: HTMLElement; view: VirtualizedTextView }[] = []

afterEach(() => {
  for (const { host, view } of mounted) {
    view.dispose()
    host.remove()
  }
  mounted.length = 0
  vi.restoreAllMocks()
})

describe('indexed long-line geometry', () => {
  it.each([160, 8_000])(
    'keeps a %ipx inline widget advance after scrolling it out of the window',
    (widgetWidth) => {
      const source = 'a'.repeat(20_000)
      const buffer = createEditorTextBuffer(source)
      const view = mountView(4)
      view.setText(buffer.getTextSnapshot())
      view.setScrollMetrics(0, 100, 360)
      view.setInlineMap(
        createInlineMap(buffer.getSnapshot(), [
          {
            id: 'wide-widget',
            startIndex: 10,
            endIndex: 10,
            insertion: true,
            text: 'IMG',
            render: (host) => {
              const widget = host.ownerDocument.createElement('span')
              widget.style.display = 'inline-block'
              widget.style.width = `${widgetWidth}px`
              widget.style.height = '16px'
              host.append(widget)
            },
          },
        ]),
      )
      const widget = view
        .getState()
        .mountedRows[0]!.element.querySelector<HTMLElement>('[data-editor-inline-widget]')!
      const width = widget.getBoundingClientRect().width
      expect(width).toBe(widgetWidth)
      const { characterWidth } = view.getState().metrics
      const target = 5_000
      view.setScrollMetrics(0, 100, 360, (target - 8) * characterWidth + width)
      const row = view.getState().mountedRows[0]!
      const caret = view.createRange(target, target)!
      const x = caret.getBoundingClientRect().left - row.element.getBoundingClientRect().left
      expect(x).toBeCloseTo(target * characterWidth + width, 0)
      const internal = Reflect.get(view, 'view') as VirtualizedTextViewInternal
      expect(offsetToX(internal, row, target)).toBeCloseTo(x, 0)
      expect(xToOffset(internal, row, x)).toBe(target)
    },
  )

  it('materializes bounded text windows across a giant grapheme-bearing line', () => {
    const source = 'a'.repeat(511) + '😀e\u0301' + 'a'.repeat(1_048_576)
    const buffer = createEditorTextBuffer(source)
    const snapshot = buffer.getTextSnapshot()
    const reads = vi.spyOn(snapshot, 'readRange')
    const view = mountView(4)
    view.setText(snapshot)
    view.setScrollMetrics(0, 100, 360)
    const { characterWidth } = view.getState().metrics
    for (const column of [510, 500_000, source.length - 40, 0]) {
      view.setScrollMetrics(0, 100, 360, column * characterWidth)
      const row = view.getState().mountedRows[0]!
      expect(typeof row.text).toBe('object')
      expect(row.chunks.reduce((length, chunk) => length + chunk.text.length, 0)).toBeLessThan(
        2_048,
      )
      for (const chunk of row.chunks) {
        expect(chunk.text).toBe(source.slice(chunk.localStart, chunk.localEnd))
        expect(chunk.text).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/)
        expect(chunk.text.charAt(0)).not.toBe('\u0301')
      }
    }
    expect(reads).toHaveBeenCalled()
    expect(reads.mock.calls.every(([start, end]) => end - start <= 4_096)).toBe(true)
  })

  it('keeps scrolled caret and hit-test positions through edits, undo, and redo in two tab sizes', () => {
    const original = 'abc\t😀e\u0301xyz\t' + 'a'.repeat(1_048_576)
    const buffer = createEditorTextBuffer(original)
    const session = createEditorBufferSession(buffer)
    const views = [mountView(4), mountView(7)]
    for (const view of views) view.setText(buffer.getTextSnapshot())
    for (const offset of [32, 524_288, original.length - 64]) {
      for (const view of views) checkCaret(view, original, offset)
      const inserted = 'Z\t😀e\u0301'
      const change = session.applyEdits([{ from: offset, to: offset, text: inserted }])
      applyChange(views, change)
      const edited = original.slice(0, offset) + inserted + original.slice(offset)
      for (const view of views) checkCaret(view, edited, offset + inserted.length + 8)
      applyChange(views, session.undo())
      for (const view of views) checkCaret(view, original, offset + 8)
      applyChange(views, session.redo())
      for (const view of views) checkCaret(view, edited, offset + inserted.length + 8)
      applyChange(views, session.undo())
    }
    expect(buffer.getTextSnapshot().materializeFullText()).toBe(original)
  })

  it('refreshes line measurements after a split and join, then enables wrapping', () => {
    const text = 'ab\t'.repeat(2_000)
    const buffer = createEditorTextBuffer(text)
    const session = createEditorBufferSession(buffer)
    const view = mountView(7)
    view.setText(buffer.getTextSnapshot())
    checkCaret(view, text, 5_400)
    expect(view.getState().mountedRows[0]!.element.dataset.editorVirtualWindowStart).toBeDefined()
    applyChange([view], session.applyEdits([{ from: 3_000, to: 3_000, text: '\n' }]))
    view.setScrollMetrics(0, 100, 360)
    const rows = view.getState().mountedRows
    expect(rows.map((row) => row.text)).toEqual([text.slice(0, 3_000), text.slice(3_000)])
    expect(rows[1]!.measurements!.columnAt(3_000, 7, 'utf16')).toBe(7_000)
    applyChange([view], session.undo())
    checkCaret(view, text, 5_400)
    view.setWrapEnabled(true)
    view.setScrollMetrics(0, 100, 360, 0)
    expect(view.getState().mountedRows.length).toBeGreaterThan(1)
    expect(view.getState().mountedRows.every((row) => row.text.length < 100)).toBe(true)
    expect(
      view
        .getState()
        .mountedRows.every(
          (row) =>
            row.element.dataset.editorVirtualWindowStart === undefined &&
            row.element.dataset.editorVirtualWindowEnd === undefined,
        ),
    ).toBe(true)
  })
})

function mountView(tabSize: number): VirtualizedTextView {
  const host = document.createElement('div')
  host.style.width = '360px'
  host.style.height = '100px'
  document.body.appendChild(host)
  const view = new VirtualizedTextView(host, {
    rowHeight: 20,
    tabSize,
    overscan: 0,
    longLineChunkSize: 512,
    longLineChunkThreshold: 1_024,
    horizontalOverscanColumns: 0,
  })
  mounted.push({ host, view })
  return view
}

function applyChange(views: readonly VirtualizedTextView[], change: DocumentSessionChange): void {
  expect(change.edits).toHaveLength(1)
  for (const view of views) view.applyEdit(change.edits[0]!, change.textSnapshot)
}

function checkCaret(view: VirtualizedTextView, text: string, offset: number): void {
  const internal = Reflect.get(view, 'view') as VirtualizedTextViewInternal
  const { characterWidth } = view.getState().metrics
  const column = estimatedDisplayCellForColumn(text, offset, internal.tabSize)
  view.setScrollMetrics(0, 100, 360, Math.max(0, (column - 12) * characterWidth))
  view.setSelection(offset, offset)
  const row = view.getState().mountedRows[0]!
  expect(row.text.length).toBe(text.length)
  expect(row.text.slice(Math.max(0, offset - 8), offset + 8)).toBe(
    text.slice(Math.max(0, offset - 8), offset + 8),
  )
  expect(row.chunks.some((chunk) => chunk.startOffset <= offset && chunk.endOffset >= offset)).toBe(
    true,
  )
  const elements = [
    ...row.element.querySelectorAll<HTMLElement>('[data-editor-virtual-chunk-start]'),
  ]
  expect(elements.length).toBeGreaterThan(0)
  for (const element of elements) {
    const start = Number(element.dataset.editorVirtualChunkStart)
    const end = Number(element.dataset.editorVirtualChunkEnd)
    expect(end).toBeGreaterThan(start)
    expect(element.textContent).toBe(text.slice(start, end))
  }
  const range = view.createRange(offset, offset)
  expect(range).not.toBeNull()
  const rect = range!.getBoundingClientRect()
  const drawn = rect.left - row.element.getBoundingClientRect().left
  expect(rect.height).toBeGreaterThan(0)
  expect(offsetToX(internal, row, offset)).toBeCloseTo(drawn, 0)
  expect(xToOffset(internal, row, drawn)).toBe(offset)
  expect(view.textOffsetFromDomBoundary(range!.startContainer, range!.startOffset)).toBe(offset)
}
