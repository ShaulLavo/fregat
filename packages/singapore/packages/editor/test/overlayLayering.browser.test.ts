import { describe, expect, it } from 'vitest'

import '../src/style.css'
import { VirtualizedTextView } from '../src/virtualization'

describe('overlay stacking scale', () => {
  it('layers the gutter from the scale rather than a literal', () => {
    const scroll = document.createElement('div')
    const gutter = document.createElement('div')
    scroll.className = 'editor-virtualized'
    scroll.style.setProperty('--editor-z-gutter', '42')
    gutter.className = 'editor-virtualized-gutter'
    scroll.append(gutter)
    document.body.append(scroll)

    expect(getComputedStyle(gutter).zIndex).toBe('42')

    scroll.remove()
  })

  it('paints overlay tiers in order and leaves room between them', () => {
    const host = document.createElement('div')
    host.style.height = '200px'
    host.style.isolation = 'isolate'
    host.style.position = 'relative'
    host.style.width = '200px'
    // Appended below every tier it must end up under, so DOM order alone would
    // produce the opposite answer.
    const popup = overlayBox(host, 'var(--editor-z-overlay-popup)')
    const between = overlayBox(host, 'calc(var(--editor-z-overlay-widget) + 10)')
    const widget = overlayBox(host, 'var(--editor-z-overlay-widget)')
    const surface = overlayBox(host, 'var(--editor-z-overlay-surface)')
    document.body.append(host)
    const box = host.getBoundingClientRect()

    expect(document.elementFromPoint(box.left + 10, box.top + 10)).toBe(popup)
    popup.remove()
    expect(document.elementFromPoint(box.left + 10, box.top + 10)).toBe(between)
    between.remove()
    expect(document.elementFromPoint(box.left + 10, box.top + 10)).toBe(widget)
    widget.remove()
    expect(document.elementFromPoint(box.left + 10, box.top + 10)).toBe(surface)

    host.remove()
  })

  it('layers the shipped overlay rules from the scale rather than a literal', () => {
    const host = document.createElement('div')
    host.style.setProperty('--editor-z-overlay-surface', '111')
    const layer = document.createElement('div')
    layer.className = 'editor-merge-conflict-lens-layer'
    host.append(layer)
    document.body.append(host)

    expect(getComputedStyle(layer).zIndex).toBe('111')

    host.remove()
  })
})

describe('overlay width reservation', () => {
  it('reserves text insets and reveals the caret without moving native scrollbars', async () => {
    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.height = '120px'
    container.style.width = '360px'
    document.body.append(container)
    const view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
    })
    const scroll = container.querySelector<HTMLElement>('.editor-virtualized')!
    const bounds = container.getBoundingClientRect()
    const text = 'long line '.repeat(100)
    view.setText(text)

    view.reserveOverlayWidth('right', 96)

    expect(scroll.getBoundingClientRect().right).toBe(bounds.right)
    expect(scroll.getBoundingClientRect().left).toBe(bounds.left)
    expect(getComputedStyle(scroll).paddingRight).toBe('96px')
    await expect.poll(() => scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    scroll.scrollLeft = scroll.scrollWidth
    expect(scroll.scrollLeft).toBeGreaterThan(0)

    scroll.scrollLeft = 0
    await expect.poll(() => view.getState().viewportWidth).toBe(scroll.clientWidth - 96)
    await expect.poll(() => view.getState().scrollLeft).toBe(0)
    view.setSelection(text.length, text.length)
    view.revealOffset(text.length)
    const caret = scroll.querySelector<HTMLElement>('.editor-virtualized-caret')!
    await expect.poll(() => caret.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(caret.getBoundingClientRect().right).toBeLessThanOrEqual(
      scroll.getBoundingClientRect().right - 96,
    )
    expect(scroll.scrollLeft).toBeGreaterThan(0)

    view.reserveOverlayWidth('right', 0)
    view.reserveOverlayWidth('left', 48)

    expect(scroll.getBoundingClientRect().left).toBe(bounds.left)
    expect(scroll.getBoundingClientRect().right).toBe(bounds.right)
    expect(getComputedStyle(scroll).paddingLeft).toBe('48px')
    expect(getComputedStyle(scroll).paddingRight).toBe('0px')

    view.reserveOverlayWidth('left', 0)

    expect(scroll.getBoundingClientRect().width).toBe(bounds.width)
    expect(getComputedStyle(scroll).paddingLeft).toBe('0px')

    view.dispose()
    container.remove()
  })
})

function overlayBox(host: HTMLElement, zIndex: string): HTMLElement {
  const box = host.ownerDocument.createElement('div')
  box.style.inset = '0'
  box.style.position = 'absolute'
  box.style.zIndex = zIndex
  host.append(box)
  return box
}
