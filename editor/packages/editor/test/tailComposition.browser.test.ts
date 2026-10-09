import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'
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
  'paints native IME composition at the capped tail with %s row positioning',
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
      editor.setSelection(text.length, text.length, { reveal: true })
      editor.focus()
      await frames()
      await commands.proofType('!')
      await frames()
      expect(editor.getTextSnapshot().readRange(text.length, text.length + 1)).toBe('!')
      expect(editor.getSelections()).toHaveLength(1)
      expect(editor.getSelections()[0]).toMatchObject({
        anchorOffset: text.length + 1,
        headOffset: text.length + 1,
      })
      const row = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${lines}"]`)!
      expect(row.textContent).toBe('final!')
      const rect = row.getBoundingClientRect()
      const viewport = host.querySelector('.editor-virtualized')!.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(viewport.top)
      expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom)
      await commands.proofImeComposition('候補')
      await frames()
      const composition = host.querySelector<HTMLElement>('.editor-virtualized-composition')!
      expect(composition.textContent).toBe('候補')
      expect(composition.getBoundingClientRect().top).toBeCloseTo(rect.top, 0)
      await commands.proofImeComposition('')
      expect(editor.getTextSnapshot().readRange(text.length - 5, text.length + 1)).toBe('final!')
    }
  },
)

async function frames() {
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
