import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

test('paints row-local tab stops inside a wrapped viewport', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:52px;height:600px'
  document.body.append(container)
  const editor = new Editor(container, {
    wordWrap: true,
    wordWrapBreak: 'word',
    tabSize: 4,
    fontFamily: 'monospace',
    fontSize: 16,
  })
  try {
    const text = '\t a\ta aa'.repeat(6)
    editor.setText(text)
    const rows = () =>
      [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
        .filter((row) => row.style.display !== 'none')
        .sort(
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
    const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
    await expect.poll(() => scroller.scrollWidth - scroller.clientWidth).toBe(0)
    const edge = scroller.getBoundingClientRect().left + scroller.clientWidth
    let checked = 0
    for (const row of rows()) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const end = node.data.trimEnd().length
        if (end === 0) continue
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, end)
        expect(range.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 0.5)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(3)
    await page.elementLocator(container).screenshot()
  } finally {
    editor.dispose()
    container.remove()
  }
})
