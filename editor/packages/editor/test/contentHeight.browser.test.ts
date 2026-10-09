import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession, createPieceTableSnapshot } from '../src/public/document'
import { createInlineMap } from '../src/inlineMap'
import { createEditorFindPlugin } from '../../find/src/plugin'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofContentLayoutScreenshot: (width: number) => Promise<string>
  }
}

const fontUrl = new URL('../../../site/src/fonts/jetbrains-mono.woff2', import.meta.url).href

const mounted: { editor: Editor; host: HTMLElement; parent: HTMLElement }[] = []

afterEach(() => {
  for (const { editor, parent } of mounted.splice(0)) {
    editor.dispose()
    parent.remove()
  }
})

function mount(width = 390) {
  const parent = document.createElement('div')
  parent.id = 'content-height-proof'
  parent.style.cssText = 'height:240px;overflow:auto'
  const before = document.createElement('div')
  before.style.height = '360px'
  const host = document.createElement('div')
  host.style.width = `${width}px`
  const after = document.createElement('div')
  after.style.height = '360px'
  parent.append(before, host, after)
  document.body.append(parent)
  const editor = new Editor(host, {
    scrollMode: 'content',
    wordWrap: true,
    lineHeight: 20,
    fontSize: 14,
    fontFamily: 'monospace',
    plugins: [createEditorFindPlugin()],
  })
  mounted.push({ editor, host, parent })
  return { editor, host, parent }
}

const frames = async () => {
  for (let index = 0; index < 3; index++)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}
const scroller = (host: HTMLElement) => host.querySelector<HTMLElement>('.editor-virtualized')!
const row = (host: HTMLElement, index: number) =>
  host.querySelector<HTMLElement>(`[data-editor-virtual-row="${index}"]`)!

it.each([390, 752])(
  'sizes the plain-text editor in normal flow at %s px and reveals outside it',
  async (width) => {
    const { editor, host, parent } = mount(width)
    const text = Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n')
    editor.setText(text)
    await frames()
    expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
    expect(host.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(80)
    expect(getComputedStyle(scroller(host)).overflowY).toBe('visible')
    expect(getComputedStyle(scroller(host)).overflowX).toBe('visible')
    const readingScrollports = [...host.querySelectorAll<HTMLElement>('*')].filter((element) => {
      if (element.matches('textarea, input')) return false
      const style = getComputedStyle(element)
      return (
        ['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY)
      )
    })
    expect(
      readingScrollports.filter(
        (element) =>
          element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth,
      ),
    ).toEqual([])
    expect(scroller(host).scrollHeight).toBe(scroller(host).clientHeight)
    parent.scrollTop = 360
    if ('proofContentLayoutScreenshot' in commands)
      console.info('Content layout evidence', await commands.proofContentLayoutScreenshot(width))
    editor.setSelection(text.length, text.length, { reveal: true })
    await frames()
    expect(parent.scrollTop).toBeGreaterThan(360)
    expect(editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    expect(row(host, 79).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      parent.getBoundingClientRect().bottom + 1,
    )
    editor.setSelection(0, 0, { reveal: true, revealBlock: 'center' })
    await frames()
    expect(row(host, 0).getBoundingClientRect().top).toBeGreaterThanOrEqual(
      parent.getBoundingClientRect().top,
    )
    expect(parent.scrollTop).toBeLessThanOrEqual(360)
  },
)

it('publishes changed height after edits, width and font changes without a resize loop', async () => {
  const { editor, host } = mount()
  const heights: number[] = []
  const listener = editor.onDidChangeContentHeight((height) => heights.push(height))
  editor.setText('alpha beta gamma delta '.repeat(40))
  await frames()
  const first = editor.getContentHeight()
  expect(host.getBoundingClientRect().height).toBe(first)
  host.style.width = '180px'
  await frames()
  expect(editor.getContentHeight()).toBeGreaterThan(first)
  editor.setFontSize(20)
  await frames()
  expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
  editor.setText('short\ntext')
  await frames()
  expect(host.getBoundingClientRect().height).toBe(40)
  const settled = heights.length
  await frames()
  expect(heights).toHaveLength(settled)
  expect(settled).toBeLessThan(15)
  listener.dispose()
  editor.dispose()
  host.style.width = '300px'
  await frames()
  expect(heights).toHaveLength(settled)
  expect(host.children).toHaveLength(0)
})

it('uses the same content extent with a document session and switches scroll modes', async () => {
  const { editor, host } = mount()
  const session = createDocumentSession('line\n'.repeat(40))
  editor.attachSession(session)
  await frames()
  expect(host.getBoundingClientRect().height).toBe(820)
  editor.setScrollMode('virtualized')
  host.style.height = '100px'
  await frames()
  expect(getComputedStyle(scroller(host)).overflowY).toBe('auto')
  expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeLessThan(41)
  host.style.height = ''
  editor.setScrollMode('content')
  await frames()
  expect(host.getBoundingClientRect().height).toBe(820)
  expect(host.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(41)
  session.applyEdits([{ from: 0, to: 0, text: 'new line\n' }])
  await frames()
  expect(host.getBoundingClientRect().height).toBe(840)
  editor.dispose()
})

it('updates the content extent when a bundled font loads after mount', async () => {
  const { editor, host } = mount(180)
  editor.setFontFamily('"Content Height Face", serif')
  editor.setText('iiii WWWW 0000 alpha beta '.repeat(20))
  await frames()
  const before = editor.getContentHeight()
  const face = new FontFace('Content Height Face', `url(${fontUrl})`)
  try {
    document.fonts.add(await face.load())
    await expect.poll(() => editor.getContentHeight()).not.toBe(before)
    expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
  } finally {
    document.fonts.delete(face)
  }
})

it('publishes syntax replacement extent and restores the source extent', async () => {
  const { editor, host } = mount(180)
  const text = 'source'
  editor.setText(text)
  await frames()
  expect(editor.getContentHeight()).toBe(20)
  editor.setInlineMap(
    createInlineMap(createPieceTableSnapshot(text), [
      {
        id: 'syntax-preview',
        startIndex: 0,
        endIndex: text.length,
        text: 'rendered preview words '.repeat(30),
        reveal: 'never',
      },
    ]),
  )
  await frames()
  expect(editor.getContentHeight()).toBeGreaterThan(20)
  expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
  editor.setInlineMap(null)
  await frames()
  expect(host.getBoundingClientRect().height).toBe(20)
})

it('find results and heading jumps reveal through the outside scroller', async () => {
  const { editor, host, parent } = mount()
  const text = 'first heading\n' + 'body\n'.repeat(80) + 'needle heading'
  editor.setText(text)
  await frames()
  editor.openFind()
  const input = host.querySelector<HTMLInputElement>(
    '.editor-find-input:not(.editor-find-input-standalone)',
  )!
  input.value = 'needle'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  editor.findNext()
  await frames()
  expect(parent.scrollTop).toBeGreaterThan(360)
  expect(editor.getScrollPosition().top).toBe(0)
  editor.closeFind()
  editor.jumpTo(0)
  await frames()
  expect(row(host, 0).getBoundingClientRect().top).toBeGreaterThanOrEqual(
    parent.getBoundingClientRect().top,
  )
  expect(parent.scrollTop).toBeLessThanOrEqual(360)
})

it('refuses oversized content paint while keeping virtualized mode available', async () => {
  const { editor, host } = mount()
  editor.setText('small')
  expect(() => editor.setText('x'.repeat(1_048_577))).toThrow('content layout limit')
  editor.setScrollMode('virtualized')
  editor.setText('x\n'.repeat(10_001))
  await frames()
  expect(() => editor.setScrollMode('content')).toThrow('content layout limit')
  expect(scroller(host).dataset.editorScrollMode).toBe('virtualized')
  editor.setText('short')
  editor.setScrollMode('content')
  await frames()
  expect(host.getBoundingClientRect().height).toBe(20)
})

it('reveals caret and heading offsets through document scrolling', async () => {
  const { editor, host, parent } = mount()
  parent.style.cssText = 'overflow:visible'
  const text = 'heading\n' + 'body\n'.repeat(100)
  editor.setText(text)
  await frames()
  editor.setSelection(text.length, text.length, { reveal: true })
  await frames()
  expect(window.scrollY).toBeGreaterThan(0)
  expect(row(host, 101).getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
  editor.jumpTo(0)
  await frames()
  expect(row(host, 0).getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  window.scrollTo(0, 0)
})

it('keeps unwrapped rows complete and reveals horizontally outside the editor', async () => {
  const { editor, host, parent } = mount(180)
  parent.style.width = '180px'
  editor.setWordWrap(false)
  const text = 'W'.repeat(200)
  editor.setText(text)
  await frames()
  expect(row(host, 0).textContent).toBe(text)
  expect(parent.scrollWidth).toBeGreaterThan(parent.clientWidth)
  editor.setSelection(text.length, text.length, { reveal: true })
  await frames()
  expect(parent.scrollLeft).toBeGreaterThan(0)
  expect(editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
})
