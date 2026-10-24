import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/style.css'
import { createLineGutterContribution } from '../../gutters/src/index'
import { createFoldMap } from '../src/foldMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { VirtualizedTextView } from '../src/virtualization'

describe('point queries', () => {
  let host: HTMLDivElement
  let view: VirtualizedTextView

  beforeEach(() => {
    host = document.createElement('div')
    host.style.cssText = 'width: 300px; height: 160px'
    document.body.append(host)
    view = new VirtualizedTextView(host, {
      rowHeight: 20,
      wrap: true,
      gutterContributions: [createLineGutterContribution()],
    })
    view.setScrollMetrics(0, 160, 300)
  })

  afterEach(() => {
    view.dispose()
    host.remove()
    vi.restoreAllMocks()
  })

  it('maps every wrapped segment to the buffer line it paints', () => {
    view.setText(`${'abcdefghij'.repeat(10)}\ntarget`)
    const rows = view.getState().mountedRows
    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows) {
      const rect = row.element.getBoundingClientRect()
      expect(view.rowAtPoint(rect.left + 2, rect.top + 10)).toMatchObject({
        displayRow: row.index,
        bufferRow: row.bufferRow,
        source: 'document',
        region: 'text',
      })
    }
    expect(rows.at(-1)?.bufferRow).toBe(1)
  })

  it('resolves the document line below a folded block', () => {
    const text = 'head\nbody\nlast body\ntarget'
    view.setText(text)
    view.setFoldMap(
      createFoldMap(createPieceTableSnapshot(text), [
        {
          startIndex: 0,
          endIndex: text.indexOf('\ntarget'),
          startLine: 0,
          endLine: 2,
          type: 'block',
        },
      ]),
    )
    const row = view.getState().mountedRows.at(-1)!
    const rect = row.element.getBoundingClientRect()
    expect(view.rowAtPoint(rect.left + 2, rect.top + 10)).toMatchObject({
      displayRow: 1,
      bufferRow: 3,
      source: 'document',
    })
  })

  it('distinguishes injected rows and the document row below them', () => {
    view.setText('head\ntarget')
    view.setInjectedTextRows([
      { id: 'old', anchorBufferRow: 1, placement: 'before', text: 'deleted' },
    ])
    const rows = view.getState().mountedRows
    const injected = rows[1]!.element.getBoundingClientRect()
    expect(view.rowAtPoint(injected.left + 2, injected.top + 10)).toMatchObject({
      displayRow: 1,
      bufferRow: 1,
      source: 'injected',
      offset: null,
    })
    const target = rows[2]!.element.getBoundingClientRect()
    expect(view.rowAtPoint(target.left + 2, target.top + 10)).toMatchObject({
      displayRow: 2,
      bufferRow: 1,
      source: 'document',
    })
  })

  it('answers gutter and trailing hits without pretending they are text', () => {
    view.setText('abc\ndef')
    const rect = view.scrollElement.getBoundingClientRect()
    expect(view.rowAtPoint(rect.left + 2, rect.top + 30)).toMatchObject({
      bufferRow: 1,
      region: 'gutter',
      offset: null,
    })
    expect(view.rowAtPoint(rect.right - 10, rect.top + 10)).toMatchObject({
      bufferRow: 0,
      region: 'trailing',
      offset: null,
    })
    expect(view.rowAtPoint(rect.left - 1, rect.top + 10)).toBeNull()
    expect(view.rowAtPoint(rect.left + 2, rect.top + 80)).toBeNull()
  })

  it('uses current scroll coordinates before the next render frame', () => {
    view.setWrapEnabled(false)
    view.setText(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'))
    const rect = view.scrollElement.getBoundingClientRect()
    expect(view.rowAtPoint(rect.left + 2, rect.top + 10)?.bufferRow).toBe(0)
    view.scrollElement.scrollTop = 400
    expect(view.rowAtPoint(rect.left + 2, rect.top + 10)?.bufferRow).toBe(20)
  })

  it('registers the painted zero-width marker and clears it when hidden', () => {
    view.setText('ab\u200bcd')
    const marker = host.querySelector<HTMLElement>('[data-editor-hidden-character-offset="2"]')!
    expect(marker).not.toBeNull()
    const rect = marker.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    expect(view.markerAtPoint(x, y)).toEqual({ kind: 'invisible', offset: 2 })
    view.setText('abcd')
    expect(view.markerAtPoint(x, y)).toBeNull()
  })

  it('reuses viewport and row geometry across a burst of point queries', async () => {
    view.setText('abcdefghij')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const row = view.getState().mountedRows[0]!
    const rect = row.element.getBoundingClientRect()
    const viewportReads = vi.spyOn(view.scrollElement, 'getBoundingClientRect')
    view.rowAtPoint(rect.left + 10, rect.top + 10)
    const rowReads = vi.spyOn(row.element, 'getBoundingClientRect')
    for (let i = 0; i < 100; i++) view.rowAtPoint(rect.left + 10 + (i % 10), rect.top + 10)
    expect(viewportReads).toHaveBeenCalledTimes(1)
    expect(rowReads).not.toHaveBeenCalled()
  })
})
