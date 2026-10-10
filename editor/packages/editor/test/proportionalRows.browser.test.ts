import { afterEach, beforeAll, describe, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization'
import '../src/style.css'
import { loadFreeSans } from './fixtures/freefont/load'
import { measureRowContentWidth } from '../src/virtualization/virtualizedTextViewGeometry'

describe.each(['Noto Sans', 'Geometry FreeSans'])('%s geometry', (FACE) => {
  beforeAll(async () => {
    if (FACE === 'Geometry FreeSans') await loadFreeSans()
  })

  /**
   * A long unwrapped row in a proportional face: the window mounted at a scroll offset, the spacer in
   * front of it and the horizontal extent all come from measured advances.
   */

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
    // Settle the initial ResizeObserver snapshot before changing the native scroll position.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return { container, editor, scroller }
  }

  function textWidth(text: string, fontFamily = `"${FACE}"`, chunkSize = text.length): number {
    const probe = document.createElement('span')
    probe.style.cssText = `font:13px ${fontFamily};white-space:pre;position:absolute`
    for (let start = 0; start < text.length; start += chunkSize) {
      const chunk = document.createElement('span')
      chunk.textContent = text.slice(start, start + chunkSize)
      probe.append(chunk)
    }
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

  test('keeps a bounded proportional text window while scrolling', async () => {
    const { container, scroller } = await mount()
    const row = container.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
    const rect = row.getBoundingClientRect()
    const y = rect.top + rect.height / 2
    const gutter = scroller.querySelector<HTMLElement>('.editor-virtualized-gutter')
    const gutterWidth = gutter?.getBoundingClientRect().width ?? 0

    for (const target of [30_000, 60_000, 90_000]) {
      scroller.scrollLeft = target
      await expect
        .poll(() => Number(row.dataset.editorVirtualWindowStart ?? '0'))
        .toBeGreaterThan(0)
      expect((row.textContent ?? '').length).toBeLessThan(LONG.length)
      await expect
        .poll(() => row.getBoundingClientRect().left + scroller.scrollLeft)
        .toBeCloseTo(scroller.getBoundingClientRect().left + gutterWidth, 0)
      const x = scroller.getBoundingClientRect().left + gutterWidth + scroller.clientWidth / 2
      const expected = columnAtWidth(scroller.scrollLeft + scroller.clientWidth / 2)
      const nearby = new Set([LONG[expected - 1], LONG[expected], LONG[expected + 1]])
      expect(nearby.has(characterAt(x, y))).toBe(true)
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
          () =>
            container.querySelector('[data-editor-inline-widget]')?.getBoundingClientRect().width,
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
    const editor = new VirtualizedTextView(container, {
      fontFamily: initialFace,
      wrap: false,
      longLineChunkSize: 512,
    })
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
    // A single large text node accumulates advances differently from the mounted chunks.
    expect(extent()).toBeGreaterThanOrEqual(textWidth(widest, nextFace, 512))
    await expect
      .poll(() => {
        scroller.scrollLeft = scroller.scrollWidth
        const tail = editor.createRange(widest.length, widest.length, { scrollIntoView: false })
        if (!tail) return false
        const bounds = scroller.getBoundingClientRect()
        const caret = tail.getBoundingClientRect()
        return caret.left >= bounds.left && caret.right <= bounds.right
      })
      .toBe(true)
  })
})

test('keeps the complete approximate extent after measuring a mounted proportional window', async () => {
  await loadFreeSans()
  const text = 'WWWWWWW iiiiiii '.repeat(1250)
  const host = document.createElement('div')
  host.style.cssText = 'width:500px;height:200px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: false })
  try {
    view.setText(text)
    view.setScrollMetrics(0, 200, 500)
    const row = view.getState().mountedRows[0]!
    const before = view.getState().contentWidth
    expect(row.element.textContent!.length).toBeLessThan(text.length)
    const width = measureRowContentWidth(
      (view as unknown as { view: Parameters<typeof measureRowContentWidth>[0] }).view,
      row,
    )
    expect(width).toBeGreaterThan(before - 1)
    expect(width).toBeLessThan(before + 1)
  } finally {
    view.dispose()
    host.remove()
  }
})
