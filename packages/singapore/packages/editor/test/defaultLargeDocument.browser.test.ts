import { afterEach, expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

let editor: Editor | undefined
let host: HTMLElement | undefined
let frame: HTMLIFrameElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
  frame?.remove()
})

it.each(['virtualized', 'static'] as const)(
  'keeps a 200 MiB document windowed after starting in %s mode',
  async (initialMode) => {
    host = document.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    document.body.append(host)
    editor = new Editor(host, {
      lineHeight: 20,
      wordWrap: false,
      scrollPastEnd: false,
      fontFamily: 'monospace',
      scrollMode: initialMode,
    })
    editor.setScrollMode('virtualized')
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
  },
  60_000,
)

it.each([
  ['virtualized', 'load'],
  ['static', 'load'],
  ['virtualized', 'grow'],
  ['virtualized', 'show'],
] as const)(
  'discovers the supplied-metrics scroll limit from %s mode on %s',
  async (initialMode, operation) => {
    host = document.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    if (operation === 'show') host.style.display = 'none'
    document.body.append(host)
    editor = new Editor(host, {
      lineHeight: 20,
      wordWrap: false,
      scrollPastEnd: false,
      fontFamily: 'monospace',
      scrollMode: initialMode,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
    })
    editor.setScrollMode('virtualized')
    if (operation === 'grow') editor.setText('x')
    await frames()
    const lines = 500_000
    const text = 'x\n'.repeat(lines) + 'tail'
    editor.setText(text)
    if (operation === 'show') host.style.display = 'flex'
    await frames()
    expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
    const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
    const extent = host.querySelector<HTMLElement>('.editor-virtualized-extent')!
    const nativeHeight = extent.getBoundingClientRect().height
    expect(nativeHeight).toBeGreaterThan(0)
    expect(nativeHeight).toBeLessThanOrEqual(10_000_020)
    expect(Reflect.get(Element.prototype, 'scrollHeight', scroller)).toBe(nativeHeight)
    assertNativeStickyHeight(nativeHeight, 10_000_020)
    editor.setSelection(text.length, text.length, { reveal: true })
    await frames()
    const tail = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${lines}"]`)!
    expect(tail).not.toBeNull()
    expect(tail.textContent).toBe('tail')
    const bounds = tail.getBoundingClientRect()
    const viewport = scroller.getBoundingClientRect()
    expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 1)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom + 1)
    const hit = document.elementFromPoint(bounds.left + 8, bounds.top + 10)
    expect(hit === tail || tail.contains(hit)).toBe(true)
    editor.setSelection(0, 0, { reveal: true })
    await frames()
    expect(host.querySelector('[data-editor-virtual-row="0"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
  },
  60_000,
)

it.each(['virtualized', 'static'] as const)(
  'retries an unmeasurable native cap after starting in %s mode',
  async (initialMode) => {
    // Each frame owns a fresh Document, so another test cannot prime the cap cache.
    frame = document.createElement('iframe')
    frame.style.cssText = 'width:800px;height:600px;border:0'
    document.body.append(frame)
    const nativeDocument = frame.contentDocument!
    for (const style of document.head.querySelectorAll('style,link[rel="stylesheet"]'))
      nativeDocument.head.append(style.cloneNode(true))
    host = nativeDocument.createElement('div')
    host.style.cssText = 'width:720px;height:400px;display:flex;flex-direction:column'
    nativeDocument.body.style.transform = 'scale(0)'
    nativeDocument.body.append(host)
    editor = new Editor(host, {
      lineHeight: 20,
      wordWrap: false,
      scrollPastEnd: false,
      fontFamily: 'monospace',
      inputRoute: 'edit-context',
      scrollMode: initialMode,
      textMetrics: { rowHeight: 20, characterWidth: 8 },
    })
    editor.setScrollMode('virtualized')
    const lines = 500_000
    const text = 'x\n'.repeat(lines) + 'tail'
    editor.setText(text)
    await frames()
    const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
    const extent = host.querySelector<HTMLElement>('.editor-virtualized-extent')!
    expect(extent.getBoundingClientRect().height).toBe(0)
    nativeDocument.body.style.transform = ''
    await frames()
    editor.setSelection(text.length, text.length, { reveal: true })
    await frames()
    const nativeHeight = extent.getBoundingClientRect().height
    expect(nativeHeight).toBeGreaterThan(0)
    expect(nativeHeight).toBeLessThanOrEqual(10_000_020)
    expect(Reflect.get(Element.prototype, 'scrollHeight', scroller)).toBe(nativeHeight)
    assertNativeStickyHeight(nativeHeight, 10_000_020, nativeDocument)
    const tail = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${lines}"]`)!
    expect(tail).not.toBeNull()
    expect(tail.textContent).toBe('tail')
    const viewport = scroller.getBoundingClientRect()
    const bounds = tail.getBoundingClientRect()
    expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 1)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom + 1)
    const hit = nativeDocument.elementFromPoint(bounds.left + 8, bounds.top + 10)
    expect(hit === tail || tail.contains(hit)).toBe(true)
    expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
    editor.setSelection(0, 0, { reveal: true })
    await frames()
    expect(host.querySelector('[data-editor-virtual-row="0"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(100)
  },
  60_000,
)

async function frames() {
  for (let index = 0; index < 3; index++)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}

function assertNativeStickyHeight(
  height: number,
  logicalHeight = 16_000_000,
  nativeDocument = document,
) {
  const scroller = nativeDocument.createElement('div')
  scroller.style.cssText = 'width:200px;height:200px;overflow:auto;scrollbar-width:none'
  const extent = nativeDocument.createElement('div')
  extent.style.height = `${height}px`
  const sticky = nativeDocument.createElement('div')
  sticky.style.cssText = 'position:sticky;top:0;height:200px'
  extent.append(sticky)
  scroller.append(extent)
  nativeDocument.body.append(scroller)
  try {
    extent.style.height = '16000000px'
    scroller.scrollTop = 16_000_000
    if (sticky.getBoundingClientRect().top === scroller.getBoundingClientRect().top)
      expect(height).toBe(Math.min(16_000_000, logicalHeight))
    extent.style.height = `${height}px`
    scroller.scrollTop = height
    expect(scroller.scrollHeight).toBe(height)
    expect(sticky.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top)
  } finally {
    scroller.remove()
  }
}
