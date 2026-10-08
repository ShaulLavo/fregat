import { afterEach, expect, it } from 'vitest'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'

let editor: Editor | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
})

it('reveals the final row beyond the browser layout coordinate limit', async () => {
  host = document.createElement('div')
  host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
  document.body.append(host)
  editor = new Editor(host, { lineHeight: 20, fontFamily: 'monospace', fontSize: 14 })
  const text = 'x\n'.repeat(3_000_000) + 'final'
  editor.setText(text)
  await frames()
  editor.setSelection(text.length, text.length, { reveal: true })
  editor.focus()
  await frames()
  const row = host.querySelector<HTMLElement>('[data-editor-virtual-row="3000000"]')!
  expect(row?.textContent).toBe('final')
  const rect = row.getBoundingClientRect()
  const viewport = host.querySelector<HTMLElement>('.editor-virtualized')!.getBoundingClientRect()
  console.log(
    JSON.stringify({
      row: rect.toJSON(),
      viewport: viewport.toJSON(),
      scroll: editor.getScrollPosition(),
      layers: [
        ...host.querySelectorAll<HTMLElement>(
          '.editor-virtualized-viewport,.editor-virtualized-content,.editor-virtualized-spacer',
        ),
      ].map((el) => ({
        class: el.className,
        rect: el.getBoundingClientRect().toJSON(),
        transform: el.style.transform,
        height: el.style.height,
      })),
      rowTransform: row.style.transform,
      nativeTop: Reflect.get(
        Element.prototype,
        'scrollTop',
        host.querySelector('.editor-virtualized')!,
      ),
    }),
  )
  expect(rect.top).toBeGreaterThanOrEqual(viewport.top)
  expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom)
})

async function frames() {
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
