import { afterEach, expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

let editor: Editor | undefined
let host: HTMLElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
})

it('keeps a 200 MiB document windowed and reveals its capped tail', async () => {
  host = document.createElement('div')
  host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
  document.body.append(host)
  editor = new Editor(host, {
    lineHeight: 20,
    wordWrap: false,
    scrollPastEnd: false,
    fontFamily: 'monospace',
  })
  const lines = (200 * 1024 * 1024) / 128
  const text = `${'x'.repeat(127)}\n`.repeat(lines) + 'tail'
  editor.setText(text)
  await frames()
  expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
  const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
  const extent = host.querySelector<HTMLElement>('.editor-virtualized-extent')!
  const nativeHeight = extent.getBoundingClientRect().height
  expect(nativeHeight).toBeGreaterThan(0)
  expect(nativeHeight).toBeLessThanOrEqual(16_000_000)
  expect(Reflect.get(Element.prototype, 'scrollHeight', scroller)).toBe(nativeHeight)
  assertNativeStickyHeight(nativeHeight)
  editor.setSelection(text.length, text.length, { reveal: true })
  await frames()
  const tail = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${lines}"]`)!
  expect(tail.textContent).toBe('tail')
  const viewport = scroller.getBoundingClientRect()
  const bounds = tail.getBoundingClientRect()
  expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 1)
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom + 1)
  const hit = document.elementFromPoint(bounds.left + 8, bounds.top + 10)
  expect(hit === tail || tail.contains(hit)).toBe(true)
  editor.setSelection(0, 0, { reveal: true })
  await frames()
  expect(host.querySelector('[data-editor-virtual-row="0"]')).not.toBeNull()
  expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
}, 60_000)

async function frames() {
  for (let index = 0; index < 3; index++)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}

function assertNativeStickyHeight(height: number) {
  const scroller = document.createElement('div')
  scroller.style.cssText = 'width:200px;height:200px;overflow:auto;scrollbar-width:none'
  const extent = document.createElement('div')
  extent.style.height = `${height}px`
  const sticky = document.createElement('div')
  sticky.style.cssText = 'position:sticky;top:0;height:200px'
  extent.append(sticky)
  scroller.append(extent)
  document.body.append(scroller)
  try {
    extent.style.height = '16000000px'
    scroller.scrollTop = 16_000_000
    if (sticky.getBoundingClientRect().top === scroller.getBoundingClientRect().top)
      expect(height).toBe(16_000_000)
    extent.style.height = `${height}px`
    scroller.scrollTop = height
    expect(scroller.scrollHeight).toBe(height)
    expect(sticky.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top)
  } finally {
    scroller.remove()
  }
}
