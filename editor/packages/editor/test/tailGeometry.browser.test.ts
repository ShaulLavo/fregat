import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization'
import { createLineGutterPlugin } from '../../gutters/src/index'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofType: (text: string) => Promise<void>
    proofImeComposition: (
      text: string,
      replacement?: readonly [number, number] | null,
    ) => Promise<void>
  }
}

let editor: Editor | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
})

it.each(['transform', 'top'] as const)(
  'keeps the tail reachable with %s row positioning beyond the native height cap',
  async (rowPositioning) => {
    host = document.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    document.body.append(host)
    editor = new Editor(host, {
      lineHeight: 20,
      fontFamily: 'monospace',
      fontSize: 14,
      rowPositioning,
      scrollPastEnd: false,
      plugins: [createLineGutterPlugin()],
    })
    for (const lines of [900_000, 3_000_000]) {
      const text = 'x\n'.repeat(lines) + 'final'
      editor.setText(text)
      await frames()
      const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
      const viewport = scroller.getBoundingClientRect()
      const nativeHeight = () => Reflect.get(Element.prototype, 'scrollHeight', scroller)
      const nativeTop = () => Reflect.get(Element.prototype, 'scrollTop', scroller)
      expect(nativeHeight()).toBe(16_000_000)
      const rowAt = (line: number) =>
        host!.querySelector<HTMLElement>(`[data-editor-virtual-row="${line}"]`)!

      // The native scrollbar and the public reveal must reach the same final row.
      Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.set!.call(
        scroller,
        16_000_000,
      )
      await frames()
      expect(rowAt(lines).textContent).toBe('final')
      expect(rowAt(lines).getBoundingClientRect().bottom).toBeCloseTo(viewport.bottom, 0)
      expect(nativeTop()).toBe(16_000_000 - scroller.clientHeight)

      editor.setScrollPosition({ top: 0 })
      editor.setSelection(text.length, text.length, { reveal: true })
      editor.focus()
      await frames()
      const rect = rowAt(lines).getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(viewport.top)
      expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom)
      expect(editor.textOffsetFromPoint(rect.left + 1, rect.top + 10)).toBe(text.length - 5)
      const caret = host.querySelector<HTMLElement>('.editor-virtualized-caret')!
      expect(caret.hidden).toBe(false)
      expect(caret.getBoundingClientRect().top).toBeCloseTo(rect.top, 0)
      const gutter = host.querySelector<HTMLElement>(`[data-editor-virtual-gutter-row="${lines}"]`)!
      expect(gutter.getBoundingClientRect().top).toBeCloseTo(rect.top, 0)
      await commands.proofType('!')
      await frames()
      expect(rowAt(lines).textContent).toBe('final!')
      expect(editor.getTextSnapshot().readRange(text.length, text.length + 1)).toBe('!')

      await commands.proofImeComposition('候補')
      await frames()
      const composition = host.querySelector<HTMLElement>('.editor-virtualized-composition')!
      expect(composition.textContent).toBe('候補')
      expect(composition.getBoundingClientRect().top).toBeCloseTo(rect.top, 0)
      await commands.proofImeComposition('')

      if (lines < 3_000_000) continue
      editor.setSelection(1_600_001, 1_600_001, { reveal: true })
      editor.setScrollPosition({ top: 15_999_999 })
      await frames()
      const before = rowAt(800_000).getBoundingClientRect().top
      const beforeScroll = editor.getScrollPosition().top
      editor.setScrollPosition({ top: 16_000_001 })
      await frames()
      const shift = editor.getScrollPosition().top - beforeScroll
      expect(rowAt(800_000).getBoundingClientRect().top).toBeCloseTo(before - shift, 0)
      expect(caret.getBoundingClientRect().top).toBeCloseTo(before - shift, 0)
      expect(
        editor.textOffsetFromPoint(
          rowAt(800_001).getBoundingClientRect().left + 1,
          viewport.top + 25,
        ),
      ).toBe(1_600_002)
    }
  },
)

it('captures selection paint in logical document coordinates after rebasing', async () => {
  host = document.createElement('div')
  host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { rowHeight: 20 })
  try {
    const text = 'x\n'.repeat(3_000_000) + 'final'
    view.setText(text)
    await frames()
    view.scrollElement.scrollTop = 60_000_000
    view.scrollElement.dispatchEvent(new Event('scroll'))
    await frames()
    view.setSelection(text.length - 3, text.length)
    const paint = view.captureSelectionPaint()
    expect(paint.rectangles).toHaveLength(1)
    expect(Math.abs(paint.rectangles[0]!.top - 60_000_000)).toBeLessThanOrEqual(1)
  } finally {
    view.dispose()
  }
})

async function frames() {
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
