import { it, expect } from 'vitest'
import '../src/style.css'
import { VirtualizedTextView } from '../src/virtualization'
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
async function settle() {
  await frame()
  await frame()
  await frame()
}
it.each(['top', 'transform'] as const)(
  'keeps an active preedit visible after scrolling away and back across paint origins: %s',
  async (rowPositioning) => {
    const host = document.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    document.body.append(host)
    const view = new VirtualizedTextView(host, {
      rowHeight: 20,
      rowPositioning,
      scrollPastEnd: false,
    })
    try {
      const text = 'x\n'.repeat(3_000_000) + 'final'
      view.setText(text)
      await settle()
      view.scrollElement.scrollTop = 59_999_620
      await settle()
      const initialScroll = view.getState().scrollTop
      const offset = Math.floor(initialScroll / 20) * 2 + 1
      view.setSelection(offset, offset)
      view.setCompositionPreedit('candidate')
      const candidate = host.querySelector<HTMLElement>('.editor-virtualized-composition')!
      expect(candidate.hidden).toBe(false)
      view.scrollElement.scrollTop = 0
      await settle()
      view.scrollElement.scrollTop = initialScroll
      await settle()
      expect(candidate.hidden).toBe(false)
      const row = host.querySelector<HTMLElement>(
        `[data-editor-virtual-row="${Math.floor(offset / 2)}"]`,
      )!
      expect(candidate.getBoundingClientRect().top).toBeCloseTo(row.getBoundingClientRect().top, 0)
    } finally {
      view.dispose()
      host.remove()
    }
  },
)

it.each(['top', 'transform'] as const)(
  'keeps an unfocused caret aligned during the origin-crossing paint frame: %s',
  async (rowPositioning) => {
    const host = document.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    document.body.append(host)
    const view = new VirtualizedTextView(host, {
      rowHeight: 20,
      rowPositioning,
      scrollPastEnd: false,
    })
    try {
      view.setText('x\n'.repeat(3_000_000) + 'final')
      await settle()
      view.scrollElement.scrollTop = 15_999_999
      view.setSelections([
        { anchorOffset: 1_600_001, headOffset: 1_600_001 },
        { anchorOffset: 1_600_000, headOffset: 1_600_000 },
      ])
      await settle()
      const carets = [...host.querySelectorAll<HTMLElement>('.editor-virtualized-caret')]
      const row = host.querySelector<HTMLElement>('[data-editor-virtual-row="800000"]')!
      expect(carets).toHaveLength(2)
      for (const caret of carets) {
        expect(caret.hidden).toBe(false)
        expect(caret.getBoundingClientRect().top).toBeCloseTo(row.getBoundingClientRect().top, 0)
      }
      const delta = await new Promise<number[]>((resolve) =>
        requestAnimationFrame(() => {
          view.scrollElement.scrollTop = 16_000_001
          resolve(
            carets.map(
              (caret) => caret.getBoundingClientRect().top - row.getBoundingClientRect().top,
            ),
          )
        }),
      )
      for (const displacement of delta) expect(Math.abs(displacement)).toBeLessThanOrEqual(2)
    } finally {
      view.dispose()
      host.remove()
    }
  },
)
