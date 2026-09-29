import { afterEach, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import '../src/style.css'

const PROSE =
  'The list settles before the cursor reaches it, so nothing jumps while the reader types ' +
  'into a narrow composer that wraps at words the way a text box does.'

const editors: Editor[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
})

async function mountWrapped(text: string) {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;width:240px;height:400px'
  document.body.append(container)
  containers.push(container)
  const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
  editors.push(editor)
  editor.setText(text)
  await expect.poll(() => renderedRows(container).length).toBeGreaterThan(2)
  return { container, editor }
}

function renderedRows(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-row')]
    .filter((row) => row.dataset.editorVirtualRow !== undefined && row.style.display !== 'none')
    .toSorted(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )
}

test('ends every wrapped row on a word boundary', async () => {
  const { container } = await mountWrapped(PROSE)

  const texts = renderedRows(container).map((row) => row.textContent ?? '')
  expect(texts.join('')).toBe(PROSE)
  for (const text of texts.slice(0, -1)) expect(text).toMatch(/ $/)
})

test('keeps every wrapped row inside the viewport, spaces aside', async () => {
  const { container } = await mountWrapped(PROSE)
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!

  const right = scroller.getBoundingClientRect().right
  for (const row of renderedRows(container)) {
    const range = document.createRange()
    range.selectNodeContents(row)
    const text = row.textContent ?? ''
    const trimmed = text.trimEnd().length
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
    expect(trimmed).toBeGreaterThan(0)
    expect(Math.max(...rects.map((rect) => rect.right)) - right).toBeLessThan(
      (text.length - trimmed + 1) * 10,
    )
  }
})

test('keeps a chip on one row', async () => {
  const text = 'see the @src/components/file-with-a-long-name.ts here and more words after it'
  const { container, editor } = await mountWrapped(text)
  const start = text.indexOf('@')
  const end = text.indexOf(' here')
  editor.setInlineReplacementProvider(
    () => [
      {
        id: 'chip',
        startIndex: start,
        endIndex: end,
        text: '[file-with-a-long-name.ts]',
        atomic: true,
        reveal: 'never',
        render: (element) => {
          element.textContent = 'file-with-a-long-name.ts'
        },
      },
    ],
    { trigger: 'edit' },
  )

  await expect.poll(() => container.querySelectorAll('[data-editor-inline-widget]').length).toBe(1)
  const chip = container.querySelector<HTMLElement>('[data-editor-inline-widget]')!
  const rects = chip.getClientRects()
  expect(rects).toHaveLength(1)
})
