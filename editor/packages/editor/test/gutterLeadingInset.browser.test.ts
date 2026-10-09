import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  createTextDiff,
  joinRenderLines,
} from '../../diff/dist/index.js'
import { createFoldGutterPlugin, createLineGutterPlugin } from '../../gutters/dist/index.js'
import '../src/style.css'
import '../../gutters/src/style.css'
import '../../diff/src/style.css'

// A phone-width pane pinned to the page's left edge, the case the inset exists for.
const PANE = 'display:flex;position:fixed;left:0;top:0;width:390px;height:320px'
const INSET = 12

const mounted: { editor: Editor; host: HTMLElement }[] = []

afterEach(() => {
  for (const { editor, host } of mounted.splice(0)) {
    editor.dispose()
    host.remove()
  }
})

describe('gutter leading inset', () => {
  it('starts the lanes after the inset and the text after the lanes', () => {
    const { host } = mountCodeEditor(INSET)
    const scroller = rect(host, '.editor-virtualized')
    const gutterRow = rect(host, '.editor-virtualized-gutter-row:not([hidden])')
    const firstCell = rect(host, '[data-editor-gutter-contribution="line-gutter"]')
    const textRow = rect(host, '.editor-virtualized-row')

    expect(gutterRow.left).toBe(scroller.left)
    expect(firstCell.left).toBe(scroller.left + INSET)
    expect(textRow.left).toBe(gutterRow.right)
  })

  it('leaves the lanes where they were at zero', () => {
    const flush = mountCodeEditor(0)
    const plain = mountCodeEditor(undefined)

    expect(laneLefts(flush.host)).toEqual(laneLefts(plain.host))
    expect(rect(flush.host, '.editor-virtualized-row').left).toBe(
      rect(plain.host, '.editor-virtualized-row').left,
    )
  })

  it('keeps three-digit line numbers whole beside the inset', async () => {
    const { editor, host } = mountCodeEditor(INSET)
    editor.setScrollPosition({ top: 100_000 })
    const numbers = () =>
      [
        ...host.querySelectorAll<HTMLElement>('.editor-virtualized-line-number:not([hidden])'),
      ].filter((number) => /^editor-line 1\d\d$/.test(getComputedStyle(number).counterSet))

    await expect.poll(() => numbers().length).toBeGreaterThan(0)
    for (const number of numbers()) {
      expect(number.scrollWidth).toBeLessThanOrEqual(number.clientWidth)
      const cell = number.closest<HTMLElement>('.editor-virtualized-gutter-cell')!
      const row = cell.closest<HTMLElement>('.editor-virtualized-gutter-row')!
      expectLanesInsideGutter(host, row)
      const numberBounds = number.getBoundingClientRect()
      const cellBounds = cell.getBoundingClientRect()
      expect(numberBounds.left).toBeGreaterThanOrEqual(cellBounds.left)
      expect(numberBounds.right).toBeLessThanOrEqual(cellBounds.right)
    }
  })

  it('carries the cursor-line band over the inset when every lane is highlighted', () => {
    const { editor, host } = mountCodeEditor(INSET, { gutterBackground: true })
    editor.setSelection(0, 0)
    const band = host.querySelector<HTMLElement>('.editor-virtualized-cursor-line-gutter-band')
    if (!band) throw new TypeError('Expected the cursor row to carry the gutter band')
    const inset = getComputedStyle(band, '::before')
    const lane = host.querySelector<HTMLElement>('.editor-virtualized-cursor-line-gutter')!

    expect(inset.width).toBe(`${INSET}px`)
    expect(inset.backgroundColor).toBe(getComputedStyle(lane).backgroundColor)
  })
})

describe('diff tint with a gutter leading inset', () => {
  it('tints a changed row from the pane edge to its text', () => {
    const { host } = mountDiff(INSET)
    const scroller = rect(host, '.editor-virtualized')
    const addition = rowPair(host, 'addition')
    const tint = getComputedStyle(addition.gutter).backgroundColor

    expect(tint).not.toBe('rgba(0, 0, 0, 0)')
    expect(addition.gutter.getBoundingClientRect().left).toBe(scroller.left)
    expect(addition.gutter.getBoundingClientRect().right).toBe(
      addition.text.getBoundingClientRect().left,
    )
    expect(getComputedStyle(addition.text).backgroundColor).toBe(tint)
    // The cell adds no second coat over the row's tint.
    expect(getComputedStyle(addition.cell).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(addition.cell.getBoundingClientRect().left).toBe(scroller.left + INSET)
  })

  it('keeps three-digit diff numbers whole beside the inset', () => {
    const { host } = mountDiff(INSET)
    const lanes = [
      ...host.querySelectorAll<HTMLElement>(
        '.editor-diff-gutter:not([hidden]) .editor-diff-gutter-lane-new',
      ),
    ].filter((lane) => /^\d{3}$/.test(lane.textContent ?? ''))

    expect(lanes.length).toBeGreaterThan(0)
    for (const lane of lanes) {
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth)
      const row = lane.closest<HTMLElement>('.editor-virtualized-gutter-row')!
      expectLanesInsideGutter(host, row)
      expectDiffLanesInsideGutter(host, row)
    }
  })

  it('paints the same gutter at zero as with no inset', () => {
    const flush = mountDiff(0)
    const plain = mountDiff(undefined)
    const flushRow = rowPair(flush.host, 'addition')
    const plainRow = rowPair(plain.host, 'addition')

    expect(flushRow.cell.getBoundingClientRect().width).toBe(
      plainRow.cell.getBoundingClientRect().width,
    )
    expect(flushRow.gutter.getBoundingClientRect().width).toBe(
      flushRow.cell.getBoundingClientRect().width,
    )
    expect(getComputedStyle(flushRow.gutter).backgroundColor).toBe(
      getComputedStyle(plainRow.gutter).backgroundColor,
    )
  })
})

function mountCodeEditor(
  gutterLeadingInset: number | undefined,
  cursorLineHighlight: { readonly gutterBackground?: boolean } = {},
): { editor: Editor; host: HTMLElement } {
  const host = mountHost()
  const editor = new Editor(host, {
    cursorLineHighlight,
    defaultText: Array.from({ length: 140 }, (_, index) => `line ${index + 1}`).join('\n'),
    gutterLeadingInset,
    plugins: [createLineGutterPlugin(), createFoldGutterPlugin()],
  })
  mounted.push({ editor, host })
  return { editor, host }
}

function mountDiff(gutterLeadingInset: number | undefined): { editor: Editor; host: HTMLElement } {
  const host = mountHost()
  const plugin = createDiffPlugin({ mode: 'document', side: 'stacked', syntaxHighlight: false })
  const editor = new Editor(host, {
    ...createDiffEditorOptions(),
    gutterLeadingInset,
    plugins: [plugin],
  })
  mounted.push({ editor, host })
  plugin.onDidChangeRows(() => editor.setText(joinRenderLines(plugin.getRows())))
  const lines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`)
  const changed = lines.map((line, index) => (index === 109 ? 'line 110 changed' : line))
  plugin.setFile(
    createTextDiff({
      oldFile: { path: 'long.txt', text: `${lines.join('\n')}\n` },
      newFile: { path: 'long.txt', text: `${changed.join('\n')}\n` },
    }),
  )
  return { editor, host }
}

function mountHost(): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText = PANE
  document.body.append(host)
  return host
}

function rect(host: HTMLElement, selector: string): DOMRect {
  const element = host.querySelector<HTMLElement>(selector)
  if (!element) throw new TypeError(`No ${selector}`)
  return element.getBoundingClientRect()
}

function laneLefts(host: HTMLElement): number[] {
  const row = host.querySelector<HTMLElement>('.editor-virtualized-gutter-row:not([hidden])')!
  return Array.from(
    row.querySelectorAll<HTMLElement>('.editor-virtualized-gutter-cell'),
    (cell) => cell.getBoundingClientRect().left,
  )
}

function rowPair(
  host: HTMLElement,
  type: 'addition' | 'deletion',
): { gutter: HTMLElement; cell: HTMLElement; text: HTMLElement } {
  const gutter = host.querySelector<HTMLElement>(`.editor-diff-gutter-band-${type}`)
  const index = gutter?.dataset.editorVirtualGutterRow
  const text = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${index}"]`)
  const cell = gutter?.querySelector<HTMLElement>('.editor-diff-gutter')
  if (!gutter || !text || !cell) throw new TypeError(`No mounted ${type} row`)
  return { gutter, cell, text }
}

function expectLanesInsideGutter(host: HTMLElement, row: HTMLElement): void {
  const gutter = row.getBoundingClientRect()
  const text = rect(host, `[data-editor-virtual-row="${row.dataset.editorVirtualGutterRow}"]`)
  const cells = [...row.querySelectorAll<HTMLElement>('.editor-virtualized-gutter-cell')]
  expect(cells.length).toBeGreaterThan(0)
  expect(gutter.right).toBe(text.left)
  expect(cells[0]!.getBoundingClientRect().left).toBe(gutter.left + INSET)
  for (const cell of cells) {
    const bounds = cell.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(gutter.left + INSET)
    expect(bounds.right).toBeLessThanOrEqual(gutter.right)
    expect(bounds.right).toBeLessThanOrEqual(text.left)
  }
  expect(cells.at(-1)!.getBoundingClientRect().right).toBe(text.left)
}

function expectDiffLanesInsideGutter(host: HTMLElement, row: HTMLElement): void {
  const gutter = row.getBoundingClientRect()
  const text = rect(host, `[data-editor-virtual-row="${row.dataset.editorVirtualGutterRow}"]`)
  const cell = rect(row, '.editor-diff-gutter')
  const lanes = [...row.querySelectorAll<HTMLElement>('.editor-diff-gutter-lane')]
  expect(lanes).toHaveLength(3)
  for (const lane of lanes) {
    const bounds = lane.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(gutter.left + INSET)
    expect(bounds.left).toBeGreaterThanOrEqual(cell.left)
    expect(bounds.right).toBeLessThanOrEqual(cell.right)
    expect(bounds.right).toBeLessThanOrEqual(gutter.right)
    expect(bounds.right).toBeLessThanOrEqual(text.left)
  }
  expect(lanes.at(-1)!.getBoundingClientRect().right).toBe(text.left)
}
