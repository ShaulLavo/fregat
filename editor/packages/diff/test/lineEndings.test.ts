import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import { createDiffEditorOptions, createDiffPlugin, createTextDiff, joinRenderLines } from '../src'
import type { DiffFile, DiffGutterSide } from '../src'
import { highlightRegistry, installHighlightPolyfill } from './support/highlightPolyfill'

// The editor folds the text a host pushes the way it ingests a file, so every offset a row
// publishes (tokens, inline tint, row decorations) holds only while a row is exactly one line of it.
const CASES = {
  crlf: {
    old: 'keep\r\nconst value = 1\r\ndrop\r\ntail\r\n',
    new: 'keep\r\nconst value = 2\r\ntail\r\nadded\r\n',
  },
  mixed: {
    old: 'keep\nconst value = 1\r\ntail\r\n',
    new: 'keep\r\nconst value = 2\ntail\r\n',
  },
  'cr before crlf': {
    old: 'keep\r\r\nconst value = 1\r\n',
    new: 'keep\r\r\nconst value = 2\r\n',
  },
  'lone cr inside a line': {
    old: 'keep\rmore\nconst value = 1\n',
    new: 'keep\rmore\nconst value = 2\n',
  },
  'byte order mark': {
    old: '\uFEFFkeep\r\nconst value = 1\r\n',
    new: '\uFEFFkeep\r\nconst value = 2\r\n',
  },
  'lone cr ending the file': {
    old: 'keep\nconst value = 1\r',
    new: 'keep\nconst value = 2\r',
  },
} as const

const SIDES: readonly DiffGutterSide[] = ['stacked', 'old', 'new']

describe.each(Object.entries(CASES))('%s diff', (_name, texts) => {
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

  it.each(SIDES)('the %s pane holds each row at the offset its consumers count', (side) => {
    const rows = mount(diffOf(texts), side)
    const buffer = editor!.getTextSnapshot().materializeFullText()

    let start = 0
    const misplaced: string[] = []
    for (const row of rows) {
      if (buffer.slice(start, start + row.text.length) !== asEditorText(row.text)) {
        misplaced.push(row.text)
      }
      start += row.text.length + 1
    }
    expect(misplaced).toEqual([])
    expect(buffer.length).toBe(joinRenderLines(rows).length)
  })

  it('tints exactly the changed word', () => {
    mount(diffOf(texts), 'stacked')

    expect(inlineTintTexts()).toEqual(['1', '2'])
  })

  function mount(file: DiffFile, side: DiffGutterSide) {
    host = document.createElement('div')
    host.className = 'editor-diff-view'
    document.body.appendChild(host)

    const plugin = createDiffPlugin({ mode: 'document', side, syntaxHighlight: false })
    editor = createVisibleEditor(host, { ...createDiffEditorOptions(), plugins: [plugin] })
    plugin.setFile(file)
    const rows = plugin.getRows()
    editor.setText(joinRenderLines(rows))
    return rows
  }
})

// A CR or U+2028/U+2029 left inside a line is a line break to the editor, one unit wide.
function asEditorText(text: string): string {
  return text.replace(/[\r\u2028\u2029]/g, '\n')
}

function diffOf(texts: { readonly old: string; readonly new: string }): DiffFile {
  return createTextDiff({
    oldFile: { path: 'note.ts', text: texts.old },
    newFile: { path: 'note.ts', text: texts.new },
  })
}

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
