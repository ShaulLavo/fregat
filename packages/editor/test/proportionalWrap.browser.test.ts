import { afterEach, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import type { EditorWrapBreak } from '../src/index'
import '../src/style.css'

/**
 * Wrap in a proportional face, placed from measured advances: a wrapped row never runs past the
 * viewport, and never stops short of it by more than the next glyph (or word) would have taken.
 */

const WIDTH = 320
const FACE = 'Noto Sans'
const TEXT = [
  'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
  'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
  'The list settles before the cursor reaches it, so nothing jumps while the reader types into a narrow composer.',
].join('\n')

const editors: Editor[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
})

async function mount(wordWrapBreak: EditorWrapBreak, fontFamily = `"${FACE}"`) {
  await document.fonts.load(`13px "${FACE}"`)
  const container = document.createElement('div')
  container.style.cssText = `display:flex;flex-direction:column;width:${WIDTH}px;height:600px`
  document.body.append(container)
  containers.push(container)
  const editor = new Editor(container, { wordWrap: true, wordWrapBreak, fontFamily })
  editors.push(editor)
  editor.setText(TEXT)
  await expect.poll(() => rows(container).length).toBeGreaterThan(6)
  return { container, editor }
}

function rows(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-row')]
    .filter((row) => row.dataset.editorVirtualRow !== undefined && row.style.display !== 'none')
    .toSorted(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )
}

/** Where the text of a row starts and ends on screen, trailing spaces left out. */
function textExtent(row: HTMLElement): { readonly left: number; readonly right: number } {
  const range = document.createRange()
  range.selectNodeContents(row)
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right)),
  }
}

function glyphWidth(container: HTMLElement, text: string): number {
  const probe = document.createElement('span')
  probe.style.cssText = `font:13px "${FACE}";white-space:pre;position:absolute`
  probe.textContent = text
  container.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}

test.each(['character', 'word'] as const)(
  'fills each %s-wrapped row to the edge without passing it',
  async (wordWrapBreak) => {
    const { container, editor } = await mount(wordWrapBreak)
    const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
    const edge = scroller.getBoundingClientRect().left + scroller.clientWidth
    const painted = rows(container)
    let checked = 0

    for (const [index, row] of painted.entries()) {
      const text = row.textContent ?? ''
      if (text.trimEnd().length === 0) continue
      const extent = textExtent(row)
      const trailing = glyphWidth(container, text.slice(text.trimEnd().length))
      expect(extent.right - trailing).toBeLessThanOrEqual(edge + 0.5)

      const next = painted[index + 1]
      const nextText = next?.textContent ?? ''
      if (!next || nextText.length === 0) continue
      if (bufferRow(editor, index + 1) !== bufferRow(editor, index)) continue
      checked += 1
      const nextUnit = wordWrapBreak === 'word' ? (nextText.match(/^\S+/)?.[0] ?? '') : nextText[0]!
      // Early by more than the next unit means the row could have held it.
      expect(extent.right - trailing + glyphWidth(container, nextUnit)).toBeGreaterThan(edge - 2)
    }
    expect(checked).toBeGreaterThan(3)
  },
)

test('rewraps when the face changes between monospace and proportional', async () => {
  const { container, editor } = await mount('character')
  const proportional = rowTexts(container)

  editor.setFontFamily('monospace')
  await expect.poll(() => rowTexts(container)).not.toEqual(proportional)
  expect(rowTexts(container)).toEqual(expect.arrayContaining([expect.stringMatching(/^i+$/)]))

  editor.setFontFamily(`"${FACE}"`)
  await expect.poll(() => rowTexts(container)).toEqual(proportional)
})

function rowTexts(container: HTMLElement): readonly string[] {
  return rows(container).map((row) => row.textContent ?? '')
}

function bufferRow(editor: Editor, index: number): number {
  const view: unknown = Reflect.get(editor, 'view')
  const internal: unknown = Reflect.get(view as object, 'view')
  const projection = Reflect.get(Reflect.get(internal as object, 'model') as object, 'projection')
  return (projection as { getRowMetrics(row: number): { bufferRow: number } }).getRowMetrics(index)
    .bufferRow
}
