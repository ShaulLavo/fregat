import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import { createDiffEditorOptions, createDiffPlugin, createTextDiff, joinRenderLines } from '../src'
import type { DiffFile } from '../src'
import { highlightRegistry, installHighlightPolyfill } from './support/highlightPolyfill'

// A React host pushes the text in a layout effect, so it lands after the rows notification
// returns. The other harnesses call `setText` inside the listener and cannot see that order.
describe('inline word-diff tint', () => {
  let editor: Editor | null = null
  let host: HTMLElement | null = null

  beforeAll(() => {
    installHighlightPolyfill()
  })

  afterEach(() => {
    editor?.dispose()
    host?.remove()
    editor = null
    host = null
  })

  it('paints once the host pushes the text after the rows notification', () => {
    mountDeferred(
      createTextDiff({
        oldFile: { path: 'note.txt', text: 'keep\nconst value = 1\n' },
        newFile: { path: 'note.txt', text: 'keep\nconst value = 2\n' },
      }),
    )

    expect(inlineTintTexts()).toEqual(['1', '2'])
  })

  it('leaves an unpaired added line to its row background', () => {
    mountDeferred(
      createTextDiff({
        oldFile: { path: 'note.txt', text: 'call(a)\n' },
        newFile: { path: 'note.txt', text: 'call(\n  a,\n  b,\n)\n' },
      }),
    )

    const tinted = inlineTintTexts().join('')
    expect(tinted).not.toContain('b,')
  })

  function mountDeferred(file: DiffFile): void {
    host = document.createElement('div')
    host.className = 'editor-diff-view'
    document.body.appendChild(host)

    const plugin = createDiffPlugin({ mode: 'document', side: 'stacked', syntaxHighlight: false })
    editor = createVisibleEditor(host, {
      ...createDiffEditorOptions(),
      plugins: [plugin],
    })
    plugin.setFile(file)
    editor.setText(joinRenderLines(plugin.getRows()))
  }
})

/** The text under every range of the plugin's inline highlight, in document order. */
function inlineTintTexts(): readonly string[] {
  const texts: string[] = []
  for (const [name, highlight] of highlightRegistry()) {
    if (!name.endsWith('-inline')) continue

    for (const range of highlight.ranges) {
      const text = range.startContainer.textContent ?? ''
      texts.push(text.slice(range.startOffset, range.endOffset))
    }
  }
  return texts
}
