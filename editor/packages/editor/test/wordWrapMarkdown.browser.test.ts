import { beforeAll, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { markdownInlineReplacements } from '../../markdown/src/replacements'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'
import '../../markdown/src/style.css'

beforeAll(() => init())

const LABEL = 'the long label with words and averylongidentifier'
const LINE = `read [${LABEL}](https://example.com) now`
const TEXT = `${LINE}\nlast`

function rowText(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
    .filter((row) => row.style.display !== 'none')
    .toSorted(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )
    .map((row) => row.textContent ?? '')
    .join('')
}

function expectContained(container: HTMLElement): void {
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
  expect(scroller.scrollWidth).toBe(scroller.clientWidth)
  const edge = scroller.getBoundingClientRect().left + scroller.clientWidth
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let checked = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('[data-editor-virtual-row]')) continue
    const end = node.data.trimEnd().length
    if (end === 0) continue
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    expect(range.getBoundingClientRect().right, node.data).toBeLessThanOrEqual(edge + 0.5)
    checked += 1
  }
  expect(checked).toBeGreaterThan(1)
}

test.each([160, 320, 390])(
  'wraps link fragments and releases their mounts on resize and reveal at %i px',
  async (width) => {
    const container = document.createElement('div')
    container.style.cssText = `display:flex;width:${width}px;height:600px`
    document.body.append(container)
    const editor = new Editor(container, {
      wordWrap: true,
      wordWrapBreak: 'word',
      fontFamily: 'monospace',
      fontSize: 16,
    })
    const parser = new MarkdownDocument()
    let mounted = 0
    let disposed = 0
    const opened: string[] = []
    try {
      parser.setText(TEXT)
      const specs = markdownInlineReplacements(
        createStringTextSnapshot(TEXT),
        parser.decorations(0, TEXT.length),
        {
          openLink: (href) => opened.push(href),
          registerKeymapNode: () => {
            mounted += 1
            return {
              dispose: () => {
                disposed += 1
              },
            }
          },
        },
      )
      editor.setText(TEXT)
      editor.setSelection(TEXT.length)
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      await expect.poll(() => container.querySelectorAll('a').length).toBeGreaterThan(1)
      expectContained(container)
      const links = [...container.querySelectorAll('a')]
      expect(links.map((anchor) => anchor.textContent ?? '').join('')).toBe(LABEL)
      for (const anchor of links) {
        expect(anchor.href).toBe('https://example.com/')
        anchor.click()
      }
      expect(opened).toEqual(links.map(() => 'https://example.com'))
      const initialMounts = mounted
      container.style.width = '120px'
      // Refresh the preview while ResizeObserver delivery is pending.
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => disposed).toBeGreaterThanOrEqual(initialMounts)
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      // Replacement disposal can finish before the resize frame updates the editor's extent.
      const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
      await expect.poll(() => scroller.clientWidth).toBe(120)
      await expect.poll(() => scroller.scrollWidth).toBe(120)
      expectContained(container)
      const resizedMounts = mounted
      editor.setSelection(TEXT.indexOf('long') + 1)
      await expect.poll(() => container.querySelectorAll('a').length).toBe(0)
      await expect.poll(() => rowText(container)).toBe(`${LINE}last`)
      await expect.poll(() => disposed).toBe(resizedMounts)
      expectContained(container)
      editor.setSelection(TEXT.length)
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      expectContained(container)
      await page.elementLocator(container).screenshot()
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
    }
    expect(disposed).toBe(mounted)
  },
)

test.each([
  [
    'read **averylongidentifier** and _emphasized words_ now',
    'read averylongidentifier and emphasized words now',
  ],
  [
    'use `@singapore-editor/tree-sitter-languages` now',
    'use @singapore-editor/tree-sitter-languages now',
  ],
])(
  'keeps Markdown preview and revealed marks inside a narrow row for %s',
  async (line, preview) => {
    const container = document.createElement('div')
    container.style.cssText = 'display:flex;width:160px;height:600px'
    document.body.append(container)
    const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
    const parser = new MarkdownDocument()
    const text = `${line}\nlast`
    try {
      parser.setText(text)
      const specs = markdownInlineReplacements(
        createStringTextSnapshot(text),
        parser.decorations(0, text.length),
      )
      editor.setText(text)
      editor.setSelection(text.length)
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => rowText(container)).toBe(`${preview}last`)
      expectContained(container)
      const target = line.includes('**') ? line.indexOf('averylongidentifier') : line.indexOf('@')
      editor.setSelection(target + 2)
      await expect
        .poll(() =>
          rowText(container).includes(
            line.includes('**')
              ? '**averylongidentifier**'
              : '`@singapore-editor/tree-sitter-languages`',
          ),
        )
        .toBe(true)
      expectContained(container)
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
    }
  },
)

test('wraps padded Markdown table links without repeating the label', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:160px;height:600px'
  document.body.append(container)
  const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
  const parser = new MarkdownDocument()
  const text = `| Item |\n| --- |\n| [**${LABEL}**](https://example.com) |\nlast`
  try {
    parser.setText(text)
    const specs = markdownInlineReplacements(
      createStringTextSnapshot(text),
      parser.decorations(0, text.length),
    )
    editor.setText(text)
    editor.setSelection(text.length)
    editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
    await expect
      .poll(() =>
        [...container.querySelectorAll('a')].map((anchor) => anchor.textContent ?? '').join(''),
      )
      .toBe(LABEL)
    expectContained(container)
  } finally {
    editor.dispose()
    parser.dispose()
    container.remove()
  }
})
