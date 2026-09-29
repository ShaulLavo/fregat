import { expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import type { EditorViewSnapshot } from '../src/plugins'
import '../src/style.css'

function mountEditor(options: { fontSize?: number; fontFamily?: string } = {}) {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:400px;height:180px'
  document.body.append(host)
  const seen: { snapshot: EditorViewSnapshot | null } = { snapshot: null }
  const editor = new Editor(host, {
    ...options,
    plugins: [
      {
        name: 'metrics-probe',
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot) => {
                seen.snapshot = snapshot
              },
              dispose: () => {},
            }),
          }),
      },
    ],
  })
  editor.setText('abcdefghij\nklmnopqrst')
  const scroll = host.querySelector<HTMLElement>('.editor-virtualized')!
  const metrics = () => {
    if (!seen.snapshot) throw new Error('no view snapshot reached the contribution')
    return seen.snapshot.metrics
  }
  const dispose = () => {
    editor.dispose()
    host.remove()
  }
  return { editor, scroll, metrics, dispose }
}

// Before the option, a host set the size through CSS and the editor noticed at the next resize
// callback: every caret, click and row laid out in between used the old face's widths.
it('measures a new font size within the call, before any frame', async () => {
  const { editor, scroll, metrics, dispose } = mountEditor({ fontSize: 13 })
  try {
    await expect.poll(() => metrics().characterWidth).toBeGreaterThan(0)
    const before = metrics()

    editor.setFontSize(26)

    expect(getComputedStyle(scroll).fontSize).toBe('26px')
    expect(metrics().characterWidth).toBeCloseTo(before.characterWidth * 2, 1)
    // Row height is its own option; a larger face does not stretch rows on its own.
    expect(metrics().rowHeight).toBe(before.rowHeight)

    editor.setFontSize(undefined)

    expect(getComputedStyle(scroll).fontSize).toBe('13px')
    expect(metrics().characterWidth).toBeCloseTo(before.characterWidth, 3)
  } finally {
    dispose()
  }
})

it('measures the first paint in the face it was constructed with', async () => {
  const small = mountEditor({ fontSize: 10 })
  const large = mountEditor({ fontSize: 20 })
  try {
    await expect.poll(() => large.metrics().characterWidth).toBeGreaterThan(0)
    await expect.poll(() => small.metrics().characterWidth).toBeGreaterThan(0)
    expect(large.metrics().characterWidth).toBeCloseTo(small.metrics().characterWidth * 2, 1)
  } finally {
    small.dispose()
    large.dispose()
  }
})

it('writes the face where popups opened over the editor read it', () => {
  const { editor, scroll, dispose } = mountEditor()
  try {
    editor.setFontFamily('serif')
    editor.setFontSize(17)

    const style = getComputedStyle(scroll)
    expect(style.getPropertyValue('--editor-font-family').trim()).toBe('serif')
    expect(style.getPropertyValue('--editor-font-size').trim()).toBe('17px')
    expect(style.fontFamily).toBe('serif')

    editor.setFontFamily(undefined)
    expect(getComputedStyle(scroll).fontFamily).toBe('monospace')
  } finally {
    dispose()
  }
})

// The view lays tabs out from its own width; a caret or hit test on the old width lands a tab's
// worth of columns away from the glyph it names.
it('lays a tab out at a new width and keeps the caret on the glyph after it', async () => {
  const { editor, scroll, metrics, dispose } = mountEditor()
  try {
    editor.setText('\tx')
    editor.setSelection(1, 1)
    await expect.poll(() => metrics().characterWidth).toBeGreaterThan(0)

    for (const tabSize of [8, 2]) {
      editor.setTabSize(tabSize)
      await new Promise(requestAnimationFrame)

      const text = scroll.querySelector('[data-editor-virtual-row="0"]')!
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode() as Text | null
      while (node && !node.data.includes('x')) node = walker.nextNode() as Text | null
      if (!node) throw new Error('no rendered x')
      const range = document.createRange()
      range.setStart(node, node.data.indexOf('x'))
      range.setEnd(node, node.data.indexOf('x') + 1)
      const glyph = range.getBoundingClientRect().left
      const caret = scroll.querySelector('.editor-virtualized-caret')!.getBoundingClientRect().left
      const rowLeft = text.getBoundingClientRect().left

      expect(Math.abs(caret - glyph)).toBeLessThanOrEqual(1)
      expect(glyph - rowLeft).toBeCloseTo(tabSize * metrics().characterWidth, 0)
    }
  } finally {
    dispose()
  }
})
