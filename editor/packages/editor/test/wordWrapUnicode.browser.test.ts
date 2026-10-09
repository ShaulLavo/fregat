import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

const mounted: { editor: Editor; container: HTMLElement }[] = []
afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.dispose()
    container.remove()
  }
})

test('paints complete graphemes on each wrapped display row', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:180px;height:500px'
  document.body.append(container)
  const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
  mounted.push({ editor, container })
  const text = 'aaaaa😀bb é '.repeat(8) + '👩‍💻 🇸🇬'
  editor.setText(text)
  const rows = () =>
    [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
      .filter((row) => row.style.display !== 'none')
      .toSorted(
        (left, right) =>
          Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
      )
  await expect
    .poll(() =>
      rows()
        .map((row) => row.textContent ?? '')
        .join(''),
    )
    .toBe(text)
  const boundaries = new Set(
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.index,
    ),
  )
  boundaries.add(text.length)
  let offset = 0
  for (const row of rows()) {
    offset += row.textContent?.length ?? 0
    expect(boundaries.has(offset)).toBe(true)
  }
  await page.elementLocator(container).screenshot()
})
