import { afterEach, expect, it } from 'vitest'
import { commands, userEvent } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession, createPieceTableSnapshot } from '../src/public/document'
import { createInlineMap } from '../src/inlineMap'
import { createEditorFindPlugin } from '../../find/src/plugin'
import '../src/style.css'
import { glyphAdvancesFor } from '../src/virtualization/glyphAdvances'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofContentLayoutScreenshot: (width: number) => Promise<string>
  }
}

const fontUrl = new URL('./fixtures/fonts/jetbrains-mono.woff2', import.meta.url).href
const fallbackFontUrl = new URL('./fixtures/fonts/source-serif-4.woff2', import.meta.url).href

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

it.each(['cold', 'prefetched'] as const)(
  'updates the content extent when a bundled font loads after mount with %s bytes',
  async (cache) => {
    const family = `Content Height ${cache}`
    const fallbackFamily = `Content Height Fallback ${cache}`
    const fallback = new FontFace(fallbackFamily, `url(${fallbackFontUrl})`)
    let face: FontFace | undefined
    await fallback.load()
    document.fonts.add(fallback)
    const { editor, host, parent } = mount(180)
    const probe = document.createElement('span')
    try {
      // Downloading bytes cannot activate the target face before the baseline is measured.
      const prefetched =
        cache === 'prefetched'
          ? await fetch(fontUrl, { cache: 'no-store' }).then((response) => response.arrayBuffer())
          : undefined
      editor.setFontFamily(`"${family}", "${fallbackFamily}"`)
      editor.setText('W'.repeat(400))
      probe.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;visibility:hidden'
      probe.textContent = 'W'
      scroller(host).append(probe)
      await frames()
      const before = editor.getContentHeight()
      const beforeAdvance = probe.getBoundingClientRect().width
      const beforeCachedAdvance = glyphAdvancesFor(scroller(host))!.advance(87)
      const bytes: ArrayBuffer =
        prefetched ??
        (await fetch(fontUrl, { cache: 'no-store' }).then((response) => response.arrayBuffer()))
      face = new FontFace(family, bytes)
      document.fonts.add(await face.load())
      await expect.poll(() => probe.getBoundingClientRect().width).toBeLessThan(beforeAdvance - 1)
      const loadedAdvance = probe.getBoundingClientRect().width
      await expect
        .poll(() => glyphAdvancesFor(scroller(host))!.advance(87))
        .toBeLessThan(beforeCachedAdvance - 1)
      expect(beforeAdvance - loadedAdvance).toBeGreaterThan(1)
      await expect
        .poll(() => glyphAdvancesFor(scroller(host))!.advance(87))
        .toBeCloseTo(loadedAdvance, 1)
      await expect.poll(() => editor.getContentHeight()).toBeLessThan(before)
      expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
      console.info('Controlled late font metrics', {
        cache,
        beforeAdvance,
        beforeCachedAdvance,
        loadedAdvance,
        before,
        after: editor.getContentHeight(),
      })
      parent.scrollTop = 360
      if ('proofContentLayoutScreenshot' in commands)
        console.info('Late font content evidence', await commands.proofContentLayoutScreenshot(180))
    } finally {
      editor.dispose()
      probe.remove()
      if (face) document.fonts.delete(face)
      document.fonts.delete(fallback)
    }
  },
)

it.each(['text', 'atomic'] as const)(
  'publishes $0 syntax replacement extent and restores the source extent',
  async (wrap) => {
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
          ...(wrap === 'text' ? { wrap } : {}),
        },
      ]),
    )
    await frames()
    if (wrap === 'text') {
      expect(editor.getContentHeight()).toBeGreaterThan(20)
      expect(host.querySelectorAll('[data-editor-virtual-row]').length).toBeGreaterThan(1)
    } else {
      expect(editor.getContentHeight()).toBe(20)
      expect(host.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(1)
    }
    expect(host.getBoundingClientRect().height).toBe(editor.getContentHeight())
    editor.setInlineMap(null)
    await frames()
    expect(host.getBoundingClientRect().height).toBe(20)
  },
)

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

function mountUnwrapped() {
  const parent = document.createElement('div')
  parent.style.cssText = 'height:240px;width:390px;overflow:auto'
  const host = document.createElement('div')
  parent.append(host)
  document.body.append(parent)
  const editor = new Editor(host, {
    scrollMode: 'content',
    wordWrap: false,
    lineHeight: 20,
    fontSize: 14,
    fontFamily: 'monospace',
  })
  mounted.push({ editor, host, parent })
  return { editor, host, parent }
}
it('review: refused replacement preserves document and paint', async () => {
  const { editor, host } = mountUnwrapped()
  const session = createDocumentSession('small')
  editor.attachSession(session)
  editor.setSelection(1, 4)
  const selection = editor.getSelections()
  const snapshot = session.getSnapshot()
  await frames()
  expect(() => editor.setText('x'.repeat(1_048_577))).toThrow('content layout limit')
  expect(editor.getTextSnapshot().length).toBe(5)
  expect(editor.getSelections()).toEqual(selection)
  expect(session.getSnapshot()).toBe(snapshot)
  expect(row(host, 0).textContent).toBe('small')
  session.applyEdits([{ from: 0, to: 1, text: 'S' }])
  await frames()
  expect(row(host, 0).textContent).toBe('Small')
})
it('review: same-line session edit cannot exceed content admission', async () => {
  const { editor, host } = mountUnwrapped()
  const session = createDocumentSession('small')
  editor.attachSession(session)
  await frames()
  let thrown: unknown
  try {
    session.applyEdits([{ from: 5, to: 5, text: 'x'.repeat(1_048_577) }])
  } catch (error) {
    thrown = error
  }
  await frames()
  expect(thrown).toMatchObject({ code: 'EDITOR_CONTENT_LAYOUT_LIMIT' })
  expect(session.getTextSnapshot().length).toBe(5)
  expect(row(host, 0).textContent).toBe('small')
  expect(session.canUndo()).toBe(false)
})
it('review: outside horizontal scrolling keeps tail text hit-testable', async () => {
  const { editor, host } = mountUnwrapped()
  const text = 'W'.repeat(200)
  editor.setText(text)
  await frames()
  editor.setSelection(text.length, text.length, { reveal: true })
  await frames()
  const row = host.querySelector('[data-editor-virtual-row="0"]')!
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && node.textContent !== text) node = walker.nextNode()
  expect(node).not.toBeNull()
  const range = document.createRange()
  range.setStart(node!, 198)
  range.setEnd(node!, 199)
  const rect = range.getBoundingClientRect()
  const x = (rect.left + rect.right) / 2
  const y = (rect.top + rect.bottom) / 2
  const offset = editor.textOffsetFromPoint(x, y)
  expect(offset).toBeGreaterThanOrEqual(198)
  expect(offset).toBeLessThanOrEqual(199)
  expect(editor.rowAtPoint(x, y)?.region).toBe('text')
  expect(editor.rowAtPoint(x, y + 50)).toBeNull()
  await userEvent.click(row, {
    position: { x: x - row.getBoundingClientRect().left, y: y - row.getBoundingClientRect().top },
    force: true,
  })
  expect(editor.getSelections()[0]?.headOffset).toBe(offset)
  const earlier = document.createRange()
  earlier.setStart(node!, 194)
  earlier.setEnd(node!, 195)
  const earlierRect = earlier.getBoundingClientRect()
  await userEvent.click(row, {
    position: {
      x: (earlierRect.left + earlierRect.right) / 2 - row.getBoundingClientRect().left,
      y: y - row.getBoundingClientRect().top,
    },
    modifiers: ['Shift'],
    force: true,
  })
  expect(editor.getSelections()[0]?.anchorOffset).toBe(offset)
  expect(editor.getSelections()[0]?.headOffset).toBeGreaterThanOrEqual(194)
  expect(editor.getSelections()[0]?.headOffset).toBeLessThanOrEqual(195)
})
it('review: page down uses outside reading viewport', async () => {
  const { editor } = mountUnwrapped()
  const text = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n')
  editor.setText(text)
  await frames()
  editor.setSelection(0, 0)
  editor.dispatchCommand('cursorPageDown')
  await frames()
  expect(editor.getSelections()[0].headOffset).toBeLessThan(text.indexOf('line 20'))
  expect(editor.getSelections()[0].headOffset).toBeGreaterThan(0)
})

it.each(['rows', 'height', 'wrapped rows'] as const)(
  'preserves the session and paint when replacement exceeds %s',
  async (dimension) => {
    const { editor, host } = mountUnwrapped()
    const session = createDocumentSession('small')
    editor.attachSession(session)
    editor.setSelection(1, 3)
    if (dimension === 'height') editor.setLineHeight(200)
    if (dimension === 'wrapped rows') {
      host.style.width = '16px'
      editor.setWordWrap(true)
    }
    await frames()
    const selection = editor.getSelections()
    const snapshot = session.getSnapshot()
    const text =
      dimension === 'rows'
        ? 'x\n'.repeat(10_000)
        : dimension === 'height'
          ? 'x\n'.repeat(5_000)
          : 'W'.repeat(30_000)
    expect(() => editor.setText(text)).toThrow(
      expect.objectContaining({ code: 'EDITOR_CONTENT_LAYOUT_LIMIT' }),
    )
    expect(session.getSnapshot()).toBe(snapshot)
    expect(editor.getTextSnapshot().readRange(0, 5)).toBe('small')
    expect(editor.getSelections()).toEqual(selection)
    expect(
      host.querySelector('.editor-virtualized-content')?.textContent ??
        [...host.querySelectorAll('[data-editor-virtual-row]')]
          .map((row) => row.textContent)
          .join(''),
    ).toBe('small')
  },
)

it('refuses ordinary and reconciled edits before changing selections or history', async () => {
  const { editor, host } = mountUnwrapped()
  const session = createDocumentSession('small')
  editor.attachSession(session)
  editor.setSelection(1, 4)
  const selection = editor.getSelections()
  const snapshot = session.getSnapshot()
  const text = 'x'.repeat(1_048_577)
  expect(() => editor.edit({ from: 5, to: 5, text })).toThrow(
    expect.objectContaining({ code: 'EDITOR_CONTENT_LAYOUT_LIMIT' }),
  )
  expect(() =>
    session.reconcile(snapshot, [[{ from: 5, to: 5, text }]], {
      origin: 'remote',
      edits: [{ from: 5, to: 5, text }],
    }),
  ).toThrow(expect.objectContaining({ code: 'EDITOR_CONTENT_LAYOUT_LIMIT' }))
  expect(session.getSnapshot()).toBe(snapshot)
  expect(editor.getSelections()).toEqual(selection)
  expect(session.canUndo()).toBe(false)
  await frames()
  expect(row(host, 0).textContent).toBe('small')
  editor.setScrollMode('virtualized')
  editor.edit({ from: 5, to: 5, text })
  expect(session.getTextSnapshot().length).toBe(text.length + 5)
})

it.each(['cursorPageDown', 'cursorPageUp', 'selectPageDown', 'selectPageUp'] as const)(
  'uses the clipped outside viewport for %s',
  async (command) => {
    const { editor, parent } = mountUnwrapped()
    const text = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n')
    editor.setText(text)
    await frames()
    const upwards = command.endsWith('Up')
    const start = upwards ? text.indexOf('line 30') : 0
    editor.setSelection(start, start, { reveal: true })
    await frames()
    editor.dispatchCommand(command)
    await frames()
    const selection = editor.getSelections()[0]!
    const expected = text.indexOf(upwards ? 'line 19' : 'line 11')
    expect(selection.headOffset).toBe(expected)
    expect(selection.anchorOffset).toBe(command.startsWith('select') ? start : expected)
    expect(parent.scrollTop).toBeGreaterThanOrEqual(0)
  },
)

it('uses the window viewport for page movement in document flow', async () => {
  const { editor, parent } = mountUnwrapped()
  parent.style.height = 'auto'
  parent.style.overflow = 'visible'
  editor.setText(Array.from({ length: 100 }, () => 'x').join('\n'))
  await frames()
  editor.setSelection(0, 0)
  editor.dispatchCommand('cursorPageDown')
  const expectedRows = Math.max(1, Math.floor(window.innerHeight / 20) - 1)
  expect(editor.getSelections()[0]?.headOffset).toBe(expectedRows * 2)
})

it('rejects oversized session attachment and releases admission when disposed', async () => {
  const { editor, host } = mountUnwrapped()
  const original = createDocumentSession('small')
  editor.attachSession(original)
  editor.setSelection(1, 3)
  const selection = editor.getSelections()
  const oversized = createDocumentSession('x'.repeat(1_048_577))
  expect(() => editor.attachSession(oversized)).toThrow(
    expect.objectContaining({ code: 'EDITOR_CONTENT_LAYOUT_LIMIT' }),
  )
  expect(editor.getSelections()).toEqual(selection)
  await frames()
  expect(row(host, 0).textContent).toBe('small')
  editor.dispose()
  expect(() => original.applyEdits([{ from: 5, to: 5, text: 'x'.repeat(1_048_577) }])).not.toThrow()
  expect(original.getTextSnapshot().length).toBe(1_048_582)
})
