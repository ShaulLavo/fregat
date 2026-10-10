import { afterEach, expect, test } from 'vitest'

import { createLineGutterContribution, createLineGutterPlugin } from '../../gutters/src/lineGutter'
import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'
import '../src/style.css'

const mounted: { editor: Editor | VirtualizedTextView; container: HTMLElement }[] = []

afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.dispose()
    container.remove()
  }
})

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]'))
    .filter((row) => row.style.display !== 'none')
    .sort((a, b) => Number(a.dataset.editorVirtualRow) - Number(b.dataset.editorVirtualRow))
}

function expectBand(container: HTMLElement, active: readonly HTMLElement[]): void {
  expect(
    rows(container).filter((row) => row.classList.contains('editor-virtualized-cursor-line-row')),
  ).toEqual(active)
  expect(
    container.querySelectorAll(
      '[data-editor-virtual-gutter-row] .editor-virtualized-cursor-line-gutter',
    ),
  ).toHaveLength(active.length)
  for (const [index, row] of active.entries()) {
    const gutter = container.querySelector<HTMLElement>(
      `[data-editor-virtual-gutter-row="${row.dataset.editorVirtualRow}"] .editor-virtualized-gutter-cell`,
    )!
    expect(gutter.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(getComputedStyle(row).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(gutter).backgroundColor).toBe(getComputedStyle(row).backgroundColor)
    const contentRect = row.getBoundingClientRect()
    const gutterRect = gutter.getBoundingClientRect()
    expect(gutterRect.top).toBeCloseTo(contentRect.top, 1)
    expect(gutterRect.height).toBeCloseTo(contentRect.height, 1)
    if (index > 0) {
      expect(contentRect.top).toBeCloseTo(active[index - 1]!.getBoundingClientRect().bottom, 1)
    }
  }
}

test.each([
  {
    name: 'two-row code',
    text: "const second = insertIntoPieceTable(first, 5, ' world')",
    fontFamily: 'monospace',
  },
  { name: 'three-plus rows', text: 'wrapped words '.repeat(15), fontFamily: 'monospace' },
  {
    name: 'bidirectional rows',
    text: 'hello שלום עולם wrapped words '.repeat(8),
    fontFamily: 'monospace',
  },
  { name: 'styled rows', text: 'wrapped words '.repeat(8), fontFamily: 'sans-serif' },
  {
    name: 'proportional rows',
    text: 'Wide WWW and narrow iii wrapped words '.repeat(8),
    fontFamily: 'sans-serif',
  },
])(
  'highlights the whole logical line from its second $name row',
  async ({ text, fontFamily, name }) => {
    const container = document.createElement('div')
    container.style.cssText = 'display:flex;width:390px;height:700px'
    document.body.append(container)
    const editor = new Editor(container, {
      defaultText: `${text}\nnext`,
      wordWrap: true,
      fontSize: 16,
      fontFamily,
      cursorLineHighlight: { rowBackground: true, gutterBackground: true, gutterNumber: true },
      plugins: [createLineGutterPlugin()],
    })
    mounted.push({ editor, container })
    if (name === 'styled rows') {
      const style = document.createElement('style')
      style.textContent = '.wrapped-highlight-styled { font-size:20px; line-height:36px; }'
      container.append(style)
      editor.setRowDecorations(new Map([[0, { className: 'wrapped-highlight-styled' }]]))
    }
    await expect.poll(() => rows(container).at(-1)?.textContent).toBe('next')
    const wrapped = rows(container).slice(0, -1)
    expect(wrapped.length).toBeGreaterThan(1)
    if (name === 'two-row code') expect(wrapped).toHaveLength(2)
    if (name === 'three-plus rows') expect(wrapped.length).toBeGreaterThan(2)
    if (name === 'styled rows') expect(getComputedStyle(wrapped[0]!).fontSize).toBe('20px')
    const secondRowOffset = wrapped[0]!.textContent!.length + 1
    editor.setSelection(secondRowOffset)
    editor.focus()
    await expect
      .poll(
        () =>
          container.querySelectorAll('[data-editor-virtual-row].editor-virtualized-cursor-line-row')
            .length,
      )
      .toBe(wrapped.length)
    expectBand(container, wrapped)

    // Moving inside the same logical line keeps every segment active.
    editor.setSelection(text.length)
    expectBand(container, wrapped)
    editor.setSelection(secondRowOffset, secondRowOffset + 2)
    expectBand(container, [])
    editor.setSelection(text.length + 1)
    expectBand(container, rows(container).slice(-1))
    editor.setSelection(secondRowOffset)
    expectBand(container, wrapped)

    editor.setWordWrap(false)
    await expect.poll(() => rows(container).length).toBe(2)
    expectBand(container, rows(container).slice(0, 1))
    editor.setWordWrap(true)
    await expect.poll(() => rows(container).length).toBe(wrapped.length + 1)
    expectBand(container, rows(container).slice(0, -1))
  },
)

test('keeps the primary caret policy with partially mounted wraps and injected rows', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:390px;height:80px'
  document.body.append(container)
  let gutterUpdates = 0
  const lineGutter = createLineGutterContribution()
  const view = new VirtualizedTextView(container, {
    wrap: true,
    rowHeight: 20,
    overscan: 0,
    gutterLeadingInset: 8,
    gutterContributions: [
      {
        ...lineGutter,
        updateCell(element, row) {
          gutterUpdates += 1
          lineGutter.updateCell(element, row)
        },
      },
    ],
    cursorLineHighlight: { rowBackground: true, gutterBackground: true },
  })
  mounted.push({ editor: view, container })
  const line = 'wrapped words '.repeat(100)
  view.setText(`${line}\nnext`)
  view.setInjectedTextRows([
    { id: 'annotation', anchorBufferRow: 0, placement: 'before', text: 'annotation' },
  ])
  view.setScrollMetrics(0, 80, 390)
  await expect.poll(() => view.getState().mountedRows.length).toBeGreaterThan(2)
  const second = view.getState().mountedRows.filter((row) => row.source === 'document')[1]!
  view.setSelections([
    { anchorOffset: second.startOffset + 1, headOffset: second.startOffset + 1 },
    { anchorOffset: line.length + 1, headOffset: line.length + 1 },
  ])
  expectBand(
    container,
    view
      .getState()
      .mountedRows.filter((row) => row.source === 'document')
      .map((row) => row.element),
  )
  expect(
    container
      .querySelector('[data-editor-virtual-row="0"]')!
      .classList.contains('editor-virtualized-cursor-line-row'),
  ).toBe(false)

  const settledUpdates = gutterUpdates
  view.setSelection(second.startOffset + 2, second.startOffset + 2)
  expect(gutterUpdates).toBe(settledUpdates)

  // The first segment and caret are offscreen; newly mounted continuation rows still paint.
  view.setScrollMetrics(200, 80, 390)
  await expect.poll(() => view.getState().mountedRows[0]!.index).toBeGreaterThan(1)
  const visible = rows(container)
  expectBand(container, visible)
  expect(
    container.querySelectorAll('.editor-virtualized-cursor-line-gutter-band:not([hidden])'),
  ).toHaveLength(visible.length)
  expect(visible.length).toBeLessThan(10)

  view.setSelections([
    { anchorOffset: second.startOffset, headOffset: second.startOffset + 2 },
    { anchorOffset: line.length + 1, headOffset: line.length + 1 },
  ])
  expectBand(container, [])
  view.setSelections([
    { anchorOffset: line.length + 1, headOffset: line.length + 1 },
    { anchorOffset: second.startOffset, headOffset: second.startOffset },
  ])
  expectBand(container, [])
  view.clearSelection()
  expectBand(container, [])
})
