import { afterEach, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization'
import '../src/style.css'

/**
 * A long unwrapped row in a proportional face: the window mounted at a scroll offset, the spacer in
 * front of it and the horizontal extent all come from measured advances.
 */

const FACE = 'Noto Sans'
const LONG = Array.from({ length: 2500 }, (_, index) =>
  index % 2 === 0 ? 'WWWWWWW ' : 'iiiiiii ',
).join('')

const editors: (Editor | VirtualizedTextView)[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
})

async function mount(text = `${LONG}\nshort`) {
  await document.fonts.load(`13px "${FACE}"`)
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;width:500px;height:200px'
  document.body.append(container)
  containers.push(container)
  const editor = new Editor(container, { fontFamily: `"${FACE}"`, wordWrap: false })
  editors.push(editor)
  editor.setText(text)
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
  await expect.poll(() => scroller.scrollWidth).toBeGreaterThan(1000)
  return { container, editor, scroller }
}

function textWidth(text: string, fontFamily = `"${FACE}"`): number {
  const probe = document.createElement('span')
  probe.style.cssText = `font:13px ${fontFamily};white-space:pre;position:absolute`
  probe.textContent = text
  document.body.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}

function characterAt(x: number, y: number): string {
  const position = document.caretPositionFromPoint(x, y)
  if (!position || position.offsetNode.nodeType !== Node.TEXT_NODE) return ''
  return position.offsetNode.textContent?.charAt(position.offset) ?? ''
}

test('reaches the end of the widest line and no further', async () => {
  const { scroller } = await mount()
  const gutter = scroller.querySelector<HTMLElement>('.editor-virtualized-gutter')
  const gutterWidth = gutter?.getBoundingClientRect().width ?? 0

  const full = textWidth(LONG)
  const extent = scroller.scrollWidth - gutterWidth
  expect(extent).toBeGreaterThanOrEqual(full)
  // Summed single-glyph advances drift from shaped layout by a face-dependent bias per glyph; over
  // 20,000 glyphs that is up to 0.5% in CI's fallback face. Slack is harmless, a short extent is not.
  expect(extent - full).toBeLessThan(Math.max(textWidth('W') * 2, full * 0.01))
})

test('mounts the text a scroll offset reaches, under the spacer that stands for the rest', async () => {
  const { container, scroller } = await mount()
  const row = container.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
  const rect = row.getBoundingClientRect()
  const y = rect.top + rect.height / 2
  const gutter = scroller.querySelector<HTMLElement>('.editor-virtualized-gutter')
  const gutterWidth = gutter?.getBoundingClientRect().width ?? 0

  for (const target of [30_000, 60_000, 90_000]) {
    scroller.scrollLeft = target
    await expect.poll(() => Number(row.dataset.editorVirtualWindowStart ?? '0')).toBeGreaterThan(0)
    await expect
      .poll(() => row.getBoundingClientRect().left + scroller.scrollLeft)
      .toBeCloseTo(scroller.getBoundingClientRect().left + gutterWidth, 0)
    const x = scroller.getBoundingClientRect().left + gutterWidth + scroller.clientWidth / 2
    const expected = columnAtWidth(scroller.scrollLeft + scroller.clientWidth / 2)
    const nearby = new Set([LONG[expected - 1], LONG[expected], LONG[expected + 1]])
    expect(nearby.has(characterAt(x, y))).toBe(true)
    expect((row.textContent ?? '').length).toBeLessThan(LONG.length)
  }
})

/** The column a full-width layout of the line puts at `width`, by bisecting measured prefixes. */
function columnAtWidth(width: number): number {
  let low = 0
  let high = LONG.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textWidth(LONG.slice(0, middle)) <= width) low = middle
    else high = middle - 1
  }
  return low
}

test.each([40, 800])(
  'paints a scrolled proportional row with a %ipx inline widget',
  async (widgetWidth) => {
    const text = 'i'.repeat(20_000)
    const { container, editor, scroller } = await mount(text)
    editor.setInlineReplacementProvider(
      () => [
        {
          id: 'hint',
          startIndex: 10,
          endIndex: 10,
          insertion: true,
          text: 'hint',
          reveal: 'never',
          render: (host) => {
            host.style.width = `${widgetWidth}px`
            host.textContent = 'hint'
          },
        },
      ],
      { trigger: 'edit' },
    )
    await expect
      .poll(
        () => container.querySelector('[data-editor-inline-widget]')?.getBoundingClientRect().width,
      )
      .toBe(widgetWidth)
    const row = container.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
    const top = row.getBoundingClientRect()
    const y = top.top + top.height / 2
    for (const fraction of [0.5, 0.85]) {
      scroller.scrollLeft = textWidth(text) * fraction + widgetWidth
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const bounds = scroller.getBoundingClientRect()
      const x = bounds.left + scroller.clientWidth / 2
      await expect
        .poll(() => {
          const position = document.caretPositionFromPoint(x, y)
          if (!position || !row.contains(position.offsetNode)) return false
          const range = document.createRange()
          range.setStart(position.offsetNode, position.offset)
          range.collapse(true)
          return Math.abs(range.getBoundingClientRect().left - x) < textWidth('i') + 1
        })
        .toBe(true)
      expect(characterAt(x, y)).toBe('i')
      expect((row.textContent ?? '').length).toBeLessThan(text.length)
    }
  },
)

test.each([
  ['monospace', `"${FACE}"`],
  [`"${FACE}"`, 'monospace'],
])('recomputes the unwrapped extent from %s to %s', async (initialFace, nextFace) => {
  const widest = 'i'.repeat(20_000)
  const text = `${widest}\nshort`
  await document.fonts.load(`13px "${FACE}"`)
  const container = document.createElement('div')
  container.style.cssText = 'width:500px;height:200px'
  document.body.append(container)
  containers.push(container)
  const editor = new VirtualizedTextView(container, { fontFamily: initialFace, wrap: false })
  editors.push(editor)
  editor.setText(text)
  editor.setScrollMetrics(0, 200, 500)
  const scroller = editor.scrollElement
  const gutter = () =>
    scroller.querySelector('.editor-virtualized-gutter')?.getBoundingClientRect().width ?? 0
  const extent = () => scroller.scrollWidth - gutter()
  const initialWidth = textWidth(widest, initialFace)
  await expect.poll(() => Math.abs(extent() - initialWidth)).toBeLessThan(initialWidth * 0.01)

  editor.setFontFamily(nextFace)
  const nextWidth = textWidth(widest, nextFace)
  expect(Math.abs(nextWidth - initialWidth)).toBeGreaterThan(1_000)
  await expect.poll(() => Math.abs(extent() - nextWidth)).toBeLessThan(nextWidth * 0.01)
  expect(extent()).toBeGreaterThanOrEqual(nextWidth)
})
