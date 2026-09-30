import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'

import { VirtualizedTextView } from '../src/virtualization'

/**
 * What only a real engine can answer about a composition: whether the reader can actually read the
 * candidate, and whether the box the OS anchors its candidate window on covers the line it is being
 * typed into. Both are questions about painted boxes, which happy-dom reports as empty.
 */
describe.skipIf(typeof globalThis.Highlight === 'undefined')('composing in a real engine', () => {
  let container: HTMLElement
  let view: VirtualizedTextView | null

  beforeEach(() => {
    container = document.createElement('div')
    container.style.height = '120px'
    container.style.width = '360px'
    document.body.appendChild(container)
    view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
    view.setText('const greeting = 1\nconst farewell = 2')
    view.setScrollMetrics(0, 120, 360, 0)
  })

  afterEach(() => {
    view?.dispose()
    container.remove()
    view = null
  })

  function preedit(): HTMLElement {
    const found = container.querySelector<HTMLElement>('.editor-virtualized-composition')
    if (!found) throw new Error('no preedit was drawn')

    return found
  }

  function input(): HTMLTextAreaElement {
    return container.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
  }

  it('draws the candidate on the line it is being typed into', () => {
    view!.setSelection(6, 6)
    view!.setCompositionPreedit('にほんご')

    const row = container.querySelectorAll('.editor-virtualized-row')[0]!.getBoundingClientRect()
    const drawn = preedit().getBoundingClientRect()

    expect(drawn.width).toBeGreaterThan(0)
    expect(drawn.top).toBeCloseTo(row.top, 0)
    expect(drawn.height).toBeCloseTo(row.height, 0)
  })

  /* The composition is not in the document, so the row underneath still draws whatever the caret
     was sitting in front of — and two runs of text on the same pixels are two runs nobody can read.
     Rows carry no stacking order of their own and mount in whatever order the reader scrolled them
     into, so being painted over them is a tier off the scale rather than a place in the DOM. */
  it('covers the text the row is still drawing underneath it', () => {
    const scroll = container.querySelector('.editor-virtualized') as HTMLElement
    scroll.style.setProperty('--editor-z-inline-surface', '42')
    view!.setSelection(6, 6)
    view!.setCompositionPreedit('にほんご')

    expect(getComputedStyle(preedit()).zIndex).toBe('42')
    expect(getComputedStyle(container.querySelector('.editor-virtualized-row')!).zIndex).toBe(
      'auto',
    )
    expect(getComputedStyle(preedit()).backgroundColor).toBe(
      getComputedStyle(scroll).backgroundColor,
    )
  })

  it('leaves clicks on the row it is covering, so a caret can still be put down under it', () => {
    view!.setSelection(6, 6)
    view!.setCompositionPreedit('にほんご')

    const drawn = preedit().getBoundingClientRect()
    const under = document.elementFromPoint(drawn.left + 2, drawn.top + drawn.height / 2)

    expect(under).toBe(container.querySelectorAll('.editor-virtualized-row')[0])
  })

  it('takes up the height of a row, which is what an emoji or accent picker anchors on', () => {
    view!.setSelection(6, 6)

    expect(input().getBoundingClientRect().height).toBeCloseTo(20, 0)
  })

  it('sits the input on the caret rather than the corner of the viewport', () => {
    view!.setSelection(12, 12)

    const caret = container
      .querySelector<HTMLElement>('.editor-virtualized-caret')!
      .getBoundingClientRect()
    const box = input().getBoundingClientRect()

    expect(box.left).toBeCloseTo(caret.left, 0)
    expect(box.top).toBeCloseTo(caret.top, 0)
  })
})

describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'hidden input anchor scrolling',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView

    beforeEach(() => {
      container = document.createElement('div')
      container.style.cssText = 'display:flex;width:360px;height:120px;transform-origin:top left'
      document.body.appendChild(container)
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
      view.setEditable(true)
    })

    afterEach(() => {
      view.dispose()
      container.remove()
    })

    it('keeps the input on the caret through focus and content writes in a scaled scrolled host', async () => {
      container.style.transform = 'translate(17px, 23px) scale(1.25)'
      const line = '0123456789'.repeat(24)
      const text = Array.from({ length: 80 }, () => line).join('\n')
      const offset = 40 * (line.length + 1) + 36
      view.setText(text)
      view.setScrollMetrics(760, 120, 360, 160)
      const { scrollElement: scroller } = view
      const input = view.inputElement as HTMLTextAreaElement
      scroller.scrollLeft = 160
      view.setSelection(offset, offset)
      await browserFrames(2)

      expect(scroller.scrollTop).toBe(760)
      expect(scroller.scrollLeft).toBe(160)
      const before = expectInputAtCaret(container, input)
      const viewport = scroller.getBoundingClientRect()
      expect(before.left).toBeGreaterThan(viewport.left)
      expect(before.top).toBeGreaterThan(viewport.top)
      expect(before.right).toBeLessThan(viewport.right)
      expect(before.bottom).toBeLessThan(viewport.bottom)
      const pageScroll = { x: window.scrollX, y: window.scrollY }

      view.focusInput()
      input.value = `${line}\n${line}`
      input.setSelectionRange(line.length + 37, line.length + 37)
      view.setSelection(offset + 1, offset + 1)
      view.focusInput()
      await browserFrames(2)

      expect(document.activeElement).toBe(input)
      expect(input.value).toBe(`${line}\n${line}`)
      expect(input.selectionStart).toBe(line.length + 37)
      expect(input.selectionStart).toBe(input.selectionEnd)
      expect(scroller.scrollTop).toBe(760)
      expect(scroller.scrollLeft).toBe(160)
      expect({ x: window.scrollX, y: window.scrollY }).toEqual(pageScroll)
      const after = expectInputAtCaret(container, input)
      expect(after.left).toBeGreaterThan(before.left)
    })

    it('keeps the input on the visible caret when logical scroll exceeds the native scroll range', async () => {
      const lines = Array.from({ length: 4000 }, (_, index) => `line${index}`)
      view.dispose()
      view = new VirtualizedTextView(container, { rowHeight: 5000, overscan: 0 })
      view.setText(lines.join('\n'))
      const offset = lines.slice(0, 2000).join('\n').length + 5
      view.setScrollMetrics(10_000_000, 120, 360, 0)
      view.setSelection(offset, offset)
      view.focusInput()
      await browserFrames(2)

      expect(view.getState().scrollTop).toBeCloseTo(10_000_000, 3)
      const nativeScrollTop: unknown = Reflect.get(
        Element.prototype,
        'scrollTop',
        view.scrollElement,
      )
      expect(nativeScrollTop).toBeGreaterThan(0)
      expect(nativeScrollTop).toBeLessThan(10_000_000)
      expect(document.activeElement).toBe(view.inputElement)
      const input = expectInputAtCaret(container, view.inputElement as HTMLTextAreaElement)
      expect(
        Math.abs(input.top - view.scrollElement.getBoundingClientRect().top),
      ).toBeLessThanOrEqual(1)
    })
  },
)

function expectInputAtCaret(container: HTMLElement, input: HTMLTextAreaElement): DOMRect {
  const caret = container
    .querySelector<HTMLElement>('.editor-virtualized-caret:not([hidden])')!
    .getBoundingClientRect()
  const box = input.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(Math.abs(box.left - caret.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.top - caret.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.height - caret.height)).toBeLessThanOrEqual(1)
  return box
}

async function browserFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
