import { afterEach, beforeAll, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { createLineGutterPlugin } from '../../gutters/src/lineGutter'
import { Editor } from '../src/editor/Editor'
import homeSample from '../../../site/src/examples/hero.ts?raw'
import '../src/style.css'

beforeAll(async () => {
  const font = new FontFace(
    'wrap-home',
    `url(${new URL('../../../site/src/fonts/jetbrains-mono.woff2', import.meta.url).href})`,
  )
  document.fonts.add(font)
  await font.load()
})

const mounted: { editor: Editor; container: HTMLElement }[] = []
afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.dispose()
    container.remove()
  }
})

const prose =
  'Singapore is a browser code editor. Mount the core on an HTML element, give it text, and add the packages your application needs.'
const fixtures = [
  ['home sample', homeSample.trimEnd()],
  ['prose', prose],
  ['identifier', 'identifier'.repeat(12)],
  ['CJK', '中文字符测试'.repeat(20)],
  ['URL', 'https://example.com/a-very-long-path/to/the/package-with-several-hyphens'],
  ['package name', '@singapore-editor/tree-sitter-languages'],
  ['nonbreaking spaces', 'a\u00a0b\u00a0c'.repeat(20)],
  ['combining sequences', 'e\u0301'.repeat(100)],
  ['emoji', '😀'.repeat(50)],
  ['trailing spaces', `${'x'.repeat(20)}${' '.repeat(20)}`],
] as const

for (const [name, source] of fixtures) {
  test.each([239.25, 240.75, 320, 390, 752, 1280])(
    `wraps ${name} and its caret inside a %s px container`,
    async (width) => {
      const container = document.createElement('div')
      container.style.cssText = `display:flex;width:${width}px;height:600px`
      document.body.append(container)
      const editor = new Editor(container, {
        wordWrap: true,
        wordWrapBreak: 'word',
        fontFamily: name === 'home sample' ? 'wrap-home' : 'monospace',
        fontSize: name === 'home sample' ? 14 : undefined,
        lineHeight: name === 'home sample' ? 22 : undefined,
        plugins: [createLineGutterPlugin({ minWidth: name === 'home sample' ? 48 : 40 })],
      })
      mounted.push({ editor, container })
      const text = `${source}\nlast`
      editor.setText(text)
      const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
      await expect
        .poll(() => container.querySelectorAll('[data-editor-virtual-row]').length)
        .toBeGreaterThan(1)
      await expect.poll(() => scroller.scrollWidth - scroller.clientWidth).toBe(0)
      const edge = scroller.getBoundingClientRect().left + scroller.clientWidth
      for (const row of container.querySelectorAll<HTMLElement>('.editor-virtualized-row')) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          const end = node.data.trimEnd().length
          if (end === 0) continue
          const range = document.createRange()
          range.setStart(node, 0)
          range.setEnd(node, end)
          expect(range.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 0.5)
        }
      }
      if (name === 'CJK' && width === 390) await page.elementLocator(container).screenshot()
      editor.setSelection(source.length, source.length)
      await expect.poll(() => scroller.scrollWidth - scroller.clientWidth).toBe(0)
      await expect.poll(() => scroller.scrollLeft).toBe(0)
      editor.setSelection(text.length, text.length)
      await expect.poll(() => scroller.scrollWidth - scroller.clientWidth).toBe(0)
      await expect.poll(() => scroller.scrollLeft).toBe(0)
    },
  )
}

test('replaces overestimated joined-emoji extent with measured paint', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:60px;height:600px'
  document.body.append(container)
  const editor = new Editor(container, {
    wordWrap: true,
    wordWrapBreak: 'word',
    fontFamily: 'monospace',
    fontSize: 16,
  })
  mounted.push({ editor, container })
  editor.setText('👨‍👩‍👧‍👦\nlast')
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
  await expect.poll(() => scroller.scrollWidth).toBe(scroller.clientWidth)
  editor.setSelection('👨‍👩‍👧‍👦'.length)
  await expect.poll(() => scroller.scrollWidth).toBe(scroller.clientWidth)
  expect(scroller.scrollLeft).toBe(0)
  await page.elementLocator(container).screenshot()
})

test('keeps trailing-space markers on their source offsets after character rewrapping', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:36px;height:240px'
  document.body.append(container)
  const editor = new Editor(container, {
    wordWrap: true,
    wordWrapBreak: 'character',
    hiddenCharacters: 'trailing',
    fontFamily: 'wrap-home',
    fontSize: 14,
    lineHeight: 22,
    plugins: [createLineGutterPlugin({ minWidth: 24 })],
  })
  mounted.push({ editor, container })
  editor.setText('ab   cd  ')
  const rows = () => [...container.querySelectorAll('.editor-virtualized-row:not([hidden])')]
  await expect.poll(() => rows().length).toBe(9)
  container.style.width = '80px'
  await expect.poll(() => container.getBoundingClientRect().width).toBe(80)
  await expect.poll(() => rows().length).toBe(3)
  const markerOffsets = () =>
    [...container.querySelectorAll<HTMLElement>('.editor-virtualized-hidden-character-marker')]
      .map((marker) => Number(marker.dataset.editorHiddenCharacterOffset))
      .sort((left, right) => left - right)
  await expect.poll(markerOffsets).toEqual([7, 8])
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
  expect(scroller.scrollWidth).toBe(scroller.clientWidth)
  await page.elementLocator(container).screenshot()
})
