import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createFoldGutterPlugin, createLineGutterPlugin } from '../../gutters/src/index'
import '../src/style.css'
import '../../gutters/src/style.css'

const mounted: { editor: Editor; host: HTMLElement }[] = []

afterEach(() => {
  for (const { editor, host } of mounted.splice(0)) {
    editor.dispose()
    host.remove()
  }
})

describe('horizontal gutter scrolling', () => {
  it('keeps the default gutter fixed and switches a live editor', async () => {
    const { editor, host } = mount()
    const gutter = element(host, '[data-editor-virtual-gutter-row="0"]')
    const left = gutter.getBoundingClientRect().left
    editor.setScrollPosition({ left: 20 })
    await frames()
    expect(gutter.getBoundingClientRect().left).toBe(left)
    editor.setGutterScroll('content')
    expect(gutter.getBoundingClientRect().left).toBeCloseTo(left - 20)
    editor.setGutterScroll('fixed')
    expect(gutter.getBoundingClientRect().left).toBe(left)
  })

  it('keeps fold markers interactive after scrolling and hides retired rows', async () => {
    const { editor, host } = mount({ gutterScroll: 'content' })
    editor.setText(
      ['alpha {', '  beta', '  gamma', '}', 'delta ' + 'abcdefghij '.repeat(80), 'epsilon'].join(
        '\n',
      ),
    )
    await expect
      .poll(() => host.querySelector('[data-editor-fold-state="expanded"]'))
      .not.toBeNull()
    editor.setScrollPosition({ left: 10 })
    await frames()
    const before = editor.getSelections()
    const toggle = element(host, '[data-editor-fold-state="expanded"]')
    await userEvent.click(toggle)
    await frames()
    expect(editor.getSelections()).toEqual(before)
    expect(host.querySelector('[data-editor-fold-state="collapsed"]')).not.toBeNull()
    const retired = [
      ...host.querySelectorAll<HTMLElement>('.editor-virtualized-gutter-row[hidden]'),
    ]
    expect(retired.length).toBeGreaterThan(0)
    expect(retired.filter((row) => row.getClientRects().length > 0)).toEqual([])
  })

  it.each(['fixed', 'content'] as const)(
    'paints and hit-tests chunked text in %s mode',
    async (gutterScroll) => {
      const { editor, host } = mount({ gutterScroll })
      editor.setText('abcdefghij'.repeat(3000))
      editor.setScrollPosition({ left: 9000 })
      await frames()
      const scroller = element(host, '.editor-virtualized')
      const bounds = scroller.getBoundingClientRect()
      const gutter = element(host, '.editor-virtualized-gutter').getBoundingClientRect()
      const x = Math.max(bounds.left, gutter.right) + 8
      const y = bounds.top + 10
      const hit = editor.rowAtPoint(x, y)
      expect(hit?.region).toBe('text')
      expect(hit?.offset).toBeGreaterThan(1000)
      if (hit?.offset == null) throw new TypeError('Expected a chunked text offset')
      editor.setSelection(hit.offset, hit.offset)
      await frames()
      expect(scroller.scrollLeft).toBe(9000)
      expect(
        Math.abs(element(host, '.editor-virtualized-caret').getBoundingClientRect().left - x),
      ).toBeLessThan(8)
    },
  )

  it.each(['fixed', 'content'] as const)(
    'aligns gutters beyond the native height in %s mode',
    async (gutterScroll) => {
      const { editor, host } = mount({ gutterScroll })
      editor.setText('line\n'.repeat(1_999_999) + 'tail ' + 'abcdefghij '.repeat(80))
      editor.setScrollPosition({ top: 40_000_000 })
      await frames()
      const row = element(host, '[data-editor-virtual-row="1999999"]')
      const gutter = element(host, '[data-editor-virtual-gutter-row="1999999"]')
      const initial = gutter.getBoundingClientRect().left
      editor.setScrollPosition({ left: 180 })
      await frames()
      const viewport = element(host, '.editor-virtualized').getBoundingClientRect()
      const box = row.getBoundingClientRect()
      expect(box.top).toBeGreaterThanOrEqual(viewport.top)
      expect(box.bottom).toBeLessThanOrEqual(viewport.bottom)
      expect(box.top).toBeCloseTo(gutter.getBoundingClientRect().top)
      expect(gutter.getBoundingClientRect().left).toBeCloseTo(
        initial - (gutterScroll === 'content' ? 180 : 0),
      )
      const x = Math.max(viewport.left, gutter.getBoundingClientRect().right) + 8
      const y = box.top + 10
      const painted = document.elementFromPoint(x, y)
      expect(painted === row || row.contains(painted)).toBe(true)
      const hit = editor.rowAtPoint(x, y)
      expect(hit?.bufferRow).toBe(1_999_999)
      expect(hit?.region).toBe('text')
      if (hit?.offset == null) throw new TypeError('Expected a tail text offset')
      editor.setSelection(hit.offset, hit.offset)
      await frames()
      expect(
        Math.abs(element(host, '.editor-virtualized-caret').getBoundingClientRect().left - x),
      ).toBeLessThan(8)
    },
    30_000,
  )

  it.each(['fixed', 'content'] as const)('moves the gutter in %s mode', async (gutterScroll) => {
    const { editor, host } = mount({ gutterScroll })
    const gutter = element(host, '[data-editor-virtual-gutter-row="0"]')
    const row = element(host, '[data-editor-virtual-row="0"]')
    const beforeGutter = gutter.getBoundingClientRect().left
    const beforeText = row.getBoundingClientRect().left
    editor.setScrollPosition({ left: 20 })
    await frames()

    expect(row.getBoundingClientRect().left).toBeCloseTo(beforeText - 20)
    expect(gutter.getBoundingClientRect().left).toBeCloseTo(
      beforeGutter - (gutterScroll === 'content' ? 20 : 0),
    )
    const box = row.getBoundingClientRect()
    const x = Math.max(box.left, gutter.getBoundingClientRect().right) + 4
    expect(editor.rowAtPoint(x, box.top + 10)?.region).toBe('text')
    const painted = document.elementFromPoint(x, box.top + 10)
    expect(painted === row || row.contains(painted)).toBe(true)
    await page.elementLocator(host).screenshot()
  })

  it.each(['fixed', 'content'] as const)(
    'hit-tests exposed text in %s mode',
    async (gutterScroll) => {
      const { editor, host } = mount({ gutterScroll })
      editor.setScrollPosition({ left: 180 })
      await frames()
      const viewport = element(host, '.editor-virtualized').getBoundingClientRect()
      const row = element(host, '[data-editor-virtual-row="0"]')
      const y = row.getBoundingClientRect().top + 10
      expect(editor.rowAtPoint(viewport.left + 8, y)?.region).toBe(
        gutterScroll === 'content' ? 'text' : 'gutter',
      )
      const gutter = element(host, '[data-editor-virtual-gutter-row="0"]').getBoundingClientRect()
      const x = Math.max(viewport.left, gutter.right) + 8
      const offset = editor.textOffsetFromPoint(x, y)
      expect(offset).not.toBeNull()
      await userEvent.click(row, {
        position: { x: x - row.getBoundingClientRect().left, y: 10 },
        force: true,
      })
      expect(editor.getSelections()[0]?.headOffset).toBe(offset)
      await frames()
      const caret = element(host, '.editor-virtualized-caret').getBoundingClientRect()
      expect(Math.abs(caret.left - x)).toBeLessThan(8)
      expect(caret.top).toBeCloseTo(row.getBoundingClientRect().top)
    },
  )

  it.each(['fixed', 'content'] as const)(
    'keeps wrapped rows aligned in %s mode',
    async (gutterScroll) => {
      const { editor, host } = mount({ gutterScroll, wordWrap: true })
      editor.setScrollPosition({ top: 300, left: 180 })
      await frames()
      const scroller = element(host, '.editor-virtualized')
      expect(scroller.scrollLeft).toBeLessThan(20)
      const viewport = scroller.getBoundingClientRect()
      const row = [
        ...host.querySelectorAll<HTMLElement>('.editor-virtualized-row:not([hidden])'),
      ].find(
        (candidate) =>
          candidate.getBoundingClientRect().top >= viewport.top &&
          (candidate.textContent?.length ?? 0) > 20,
      )
      if (!row) throw new TypeError('Expected a visible wrapped row')
      const gutter = element(
        host,
        `[data-editor-virtual-gutter-row="${row.dataset.editorVirtualRow}"]`,
      )
      expect(row.getBoundingClientRect().top).toBeCloseTo(gutter.getBoundingClientRect().top)
      expect(row.getBoundingClientRect().left).toBeCloseTo(
        gutter.getBoundingClientRect().right - (gutterScroll === 'fixed' ? scroller.scrollLeft : 0),
        0,
      )
      const box = row.getBoundingClientRect()
      const x = Math.max(box.left, gutter.getBoundingClientRect().right) + 8
      expect(editor.rowAtPoint(x, box.top + 10)?.region).toBe('text')
      let offset: number | null = null
      let pointerX = x
      row.addEventListener(
        'pointerdown',
        (event) => {
          pointerX = event.clientX
          expect(editor.rowAtPoint(event.clientX, event.clientY)?.region).toBe('text')
          offset = editor.textOffsetFromPoint(event.clientX, event.clientY)
        },
        { once: true },
      )
      const scrollLeftBeforeClick = scroller.scrollLeft
      await userEvent.click(row, { position: { x: x - box.left, y: 10 }, force: true })
      expect(offset).not.toBeNull()
      expect(editor.getSelections()[0]?.headOffset).toBe(offset)
      await frames()
      const caret = element(host, '.editor-virtualized-caret').getBoundingClientRect()
      const expectedX = pointerX + scrollLeftBeforeClick - scroller.scrollLeft
      expect(Math.abs(caret.left - expectedX)).toBeLessThan(8)
      expect(caret.top).toBeCloseTo(row.getBoundingClientRect().top)
    },
  )
})

function mount(options: { gutterScroll?: 'fixed' | 'content'; wordWrap?: boolean } = {}) {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:360px;height:220px'
  document.body.append(host)
  const editor = new Editor(host, {
    ...options,
    defaultText: ['alpha { ' + 'abcdefghij '.repeat(80), '  beta', '  gamma', '}']
      .concat(Array.from({ length: 300 }, (_, index) => `line ${index}`))
      .join('\n'),
    lineHeight: 20,
    gutterLeadingInset: 12,
    plugins: [createLineGutterPlugin(), createFoldGutterPlugin()],
  })
  mounted.push({ editor, host })
  return { editor, host }
}

function element(host: HTMLElement, selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector)
  if (!found) throw new TypeError(`No ${selector}`)
  return found
}

async function frames() {
  for (let index = 0; index < 3; index++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
