import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import { createDiffEditorOptions, createDiffPlugin, createTextDiff, joinRenderLines } from '../src'
import type { DiffFile, DiffGutterSide, DiffRenderRow } from '../src'
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
  'two byte order marks': {
    old: '\uFEFF\uFEFFkeep\r\nconst value = 1\r\n',
    new: '\uFEFF\uFEFFkeep\r\nconst value = 2\r\n',
  },
  'a line inserted before a byte-order-marked first line': {
    old: '\uFEFFkeep\nconst value = 1\n',
    new: 'header\n\uFEFFkeep\nconst value = 2\n',
  },
  'a line deleted before a byte-order-marked first line': {
    old: 'header\n\uFEFFkeep\nconst value = 1\n',
    new: '\uFEFFkeep\nconst value = 2\n',
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

  it.each(['old', 'new'] as const)('the %s lines are what an opened document holds', (side) => {
    const file = diffOf(texts)
    host = document.createElement('div')
    document.body.appendChild(host)
    editor = createVisibleEditor(host)
    editor.setText(texts[side])

    const lines = side === 'old' ? file.oldLines : file.newLines
    expect(lines.join('\n')).toBe(editor.getTextSnapshot().materializeFullText())
  })

  it.each(SIDES)('the %s pane draws each row with the text of the line it claims', (side) => {
    const file = diffOf(texts)
    const rows = mount(file, side)

    const differing = rows.flatMap((row) => {
      const claim = claimedLine(row, side)
      if (!claim) return []
      const lines = claim.side === 'old' ? file.oldLines : file.newLines
      const text = lines[claim.lineNumber - 1]
      return text === row.text ? [] : [{ row: row.text, line: text }]
    })
    expect(differing).toEqual([])
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
    expect(buffer.length).toBe(rows.map((row) => row.text).join('\n').length)
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

/** The file line a row draws: a pane's own side, and in a stacked pane the new side but for deletions. */
function claimedLine(row: DiffRenderRow, side: DiffGutterSide) {
  const lineSide = lineSideOf(row, side)
  const lineNumber = lineSide === 'old' ? row.oldLineNumber : row.newLineNumber
  return lineNumber === undefined ? null : { side: lineSide, lineNumber }
}

function lineSideOf(row: DiffRenderRow, side: DiffGutterSide): 'old' | 'new' {
  if (side !== 'stacked') return side
  return row.type === 'deletion' ? 'old' : 'new'
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
