import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import type { Editor, EditorOptions } from '../src/editor'
import type { EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { readAll } from './factories/snapshotText'
import { createVisibleEditor } from './factories/visibleEditor'

const editors: Editor[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mountEditor(options: EditorOptions = {}): Editor {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, options)
  editor['view'].setScrollMetrics(0, 240, 640)
  editors.push(editor)
  return editor
}

test('a sparse batch preserves highlights, collapsed syntax folds and row decorations', () => {
  const editor = mountEditor()
  const text = 'head\nif (x) {\n  body();\n}\ntail'
  editor.openDocument({ documentId: 'batch.ts', text })
  const startIndex = text.indexOf('{')
  const endIndex = text.indexOf('\ntail')
  editor.setSyntaxFolds([{ startIndex, endIndex, startLine: 1, endLine: 3, type: 'block' }])
  editor.fold(startIndex)
  const token = { start: 5, end: 7, style: { color: 'red' } }
  editor.setTokens([token])
  editor.setRowDecorations(new Map([[4, { className: 'tail-marker' }]]))

  editor.edit([
    { from: 0, to: 0, text: 'first\n' },
    { from: text.length, to: text.length, text: '\nlast' },
  ])

  expect(editor['tokens'].toTokens()).toEqual([{ ...token, start: 11, end: 13 }])
  expect(editor['syntaxFoldProjection']()).toEqual([
    { startIndex: startIndex + 6, endIndex: endIndex + 6, startLine: 2, endLine: 4, type: 'block' },
  ])
  expect(editor['view']['view'].foldMarkers).toEqual([
    expect.objectContaining({ startRow: 2, endRow: 4, collapsed: true }),
  ])
  expect(editor['view']['view'].rowDecorations.get(5)?.className).toBe('tail-marker')
  expect(editor['view'].contentElement.textContent).not.toContain('body();')
  expect(editor.materializeFullText()).toBe(`first\n${text}\nlast`)
})

test('a batch refreshes injected row providers against the final snapshot through undo and redo', () => {
  const providerTexts: string[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerInjectedTextRowProvider({
        getInjectedTextRows: (provider) => {
          const text = readAll(provider.textSnapshot)
          providerTexts.push(text)
          const anchorBufferRow = text.split('\n').indexOf('body')
          if (anchorBufferRow < 0) return []
          return [
            {
              id: 'body-note',
              anchorBufferRow,
              placement: 'before',
              text: 'note',
              className: 'body-note',
            },
          ]
        },
      }),
  }
  const editor = mountEditor({ plugins: [plugin] })
  const text = 'head\nbody\ntail'
  editor.openDocument({ documentId: 'injected.txt', text })
  providerTexts.length = 0

  editor.edit([
    { from: 0, to: 0, text: 'first\n' },
    { from: text.length, to: text.length, text: '\nlast' },
  ])

  const expected = 'first\nhead\nbody\ntail\nlast'
  expect(providerTexts.length).toBeGreaterThan(0)
  expect(providerTexts.every((value) => value === expected)).toBe(true)
  expect(editor['view'].getState().mountedRows.map((row) => row.text)).toEqual([
    'first',
    'head',
    'note',
    'body',
    'tail',
    'last',
  ])
  expect(
    editor['view'].getState().mountedRows.find((row) => row.source === 'injected'),
  ).toMatchObject({ injectedTextRowId: 'body-note', bufferRow: 2, startOffset: 11, endOffset: 11 })

  editor.dispatchCommand('undo')
  expect(editor['view'].getState().mountedRows.map((row) => row.text)).toEqual([
    'head',
    'note',
    'body',
    'tail',
  ])
  expect(
    editor['view'].getState().mountedRows.find((row) => row.source === 'injected'),
  ).toMatchObject({ injectedTextRowId: 'body-note', bufferRow: 1, startOffset: 5, endOffset: 5 })

  editor.dispatchCommand('redo')
  expect(editor['view'].getState().mountedRows.map((row) => row.text)).toEqual([
    'first',
    'head',
    'note',
    'body',
    'tail',
    'last',
  ])
})

test('multi-cursor typing and undo preserve a manual fold and both selections', () => {
  const editor = mountEditor()
  const text = 'head\nbody\nend\ntail'
  const session = createDocumentSession(text)
  editor.attachSession(session)
  editor.setSelection(0, text.indexOf('\ntail'))
  expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(true)
  const originalFolds = editor['manualFolds']
  expect(originalFolds).toHaveLength(1)
  session.setSelections([{ anchor: 0 }, { anchor: text.length }])
  editor.getInputElement().dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'X',
      bubbles: true,
      cancelable: true,
    }),
  )

  expect(editor.materializeFullText()).toBe(`X${text}X`)
  expect(editor['manualFolds']).toEqual([
    expect.objectContaining({
      startIndex: originalFolds[0]!.startIndex + 1,
      endIndex: originalFolds[0]!.endIndex + 1,
    }),
  ])
  expect(session.getSelections().selections).toHaveLength(2)
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe(text)
  expect(editor['manualFolds']).toEqual(originalFolds)
  expect(session.getSelections().selections).toHaveLength(2)
  editor.dispatchCommand('redo')
  expect(editor.materializeFullText()).toBe(`X${text}X`)
})

test('batch contributions see matching final text, tokens, folds and mounted rows', () => {
  const snapshots: EditorViewSnapshot[] = []
  const changes: number[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot, _kind, change) => {
            snapshots.push(snapshot)
            if (change) changes.push(change.edits.length)
          },
          dispose() {},
        }),
      }),
  }
  const editor = mountEditor({ plugins: [plugin] })
  const text = 'head\nbody\ntail'
  editor.openDocument({ documentId: 'observed.txt', text })
  editor.setTokens([{ start: 5, end: 9, style: { color: 'red' } }])
  snapshots.length = 0
  editor.edit([
    { from: 0, to: 0, text: 'X' },
    { from: text.length, to: text.length, text: 'Y' },
  ])

  expect(changes).toEqual([2])
  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) {
    expect(readAll(snapshot.textSnapshot)).toBe(`X${text}Y`)
    expect(snapshot.tokens.toTokens()).toEqual([{ start: 6, end: 10, style: { color: 'red' } }])
    expect(snapshot.visibleRows[0]?.text).toBe('Xhead')
  }
})

test('three shared views deliver reentrant batches once in committed order', () => {
  const buffer = createEditorTextBuffer('alpha\nbeta\ngamma')
  const first = mountEditor()
  let reentered = false
  const observed: string[] = []
  const second = mountEditor({
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit([
        { from: 0, to: 0, text: '1' },
        { from: 6, to: 6, text: '2' },
      ])
    },
  })
  const third = mountEditor({
    onChange: (_state, change) => {
      if (change?.kind === 'edit') observed.push(change.textSnapshot.materializeFullText())
    },
  })
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  third.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'third')))
  const syntax = [first, second, third].map((editor) => vi.spyOn(editor['syntax'], 'refresh'))
  first.edit([
    { from: 0, to: 1, text: 'A' },
    { from: 11, to: 12, text: 'G' },
  ])

  for (const editor of [first, second, third]) {
    expect(editor.materializeFullText()).toBe('1Alpha\n2beta\nGamma')
    expect(editor['view']['view'].model.textSnapshot.materializeFullText()).toBe(
      '1Alpha\n2beta\nGamma',
    )
    expect(editor['view'].contentElement.textContent).toContain('1Alpha')
  }
  expect(observed).toEqual(['Alpha\nbeta\nGamma', '1Alpha\n2beta\nGamma'])
  for (const refresh of syntax) {
    expect(refresh.mock.calls.map((call) => call[1]?.textSnapshot.materializeFullText())).toEqual([
      'Alpha\nbeta\nGamma',
      '1Alpha\n2beta\nGamma',
    ])
  }
})

test.each(['editor', 'session'])(
  'queued %s source publication preserves a selection made after its edit returned',
  (source) => {
    const buffer = createEditorTextBuffer('abc\ndef')
    const first = mountEditor()
    const secondSession = createEditorBufferSession(
      buffer,
      createEditorViewSession(buffer, 'second'),
    )
    let changed = false
    const second = mountEditor({
      onChange: (_state, change) => {
        if (change?.kind !== 'edit' || changed) return
        changed = true
        const edits = [
          { from: 0, to: 0, text: 'X' },
          { from: 4, to: 4, text: 'Y' },
        ]
        if (source === 'editor') second.edit(edits)
        else secondSession.applyEdits(edits)
        second.setSelection(0)
      },
    })
    first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
    second.attachSession(secondSession)
    first.edit([
      { from: 1, to: 2, text: 'B' },
      { from: 5, to: 6, text: 'E' },
    ])
    expect(second.getState().cursor).toEqual({ row: 0, column: 0 })
    expect(second['view']['view'].model.textSnapshot.materializeFullText()).toBe('XaBc\nYdEf')
  },
)

test('adjacent deletions undo to the same text in the session and the view', () => {
  const editor = mountEditor()
  editor.openDocument({ documentId: 'adjacent.txt', text: 'abX' })
  editor.edit([
    { from: 0, to: 1, text: '' },
    { from: 1, to: 2, text: '' },
  ])
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('abX')
  expect(editor['view'].contentElement.textContent).toContain('abX')
  editor.dispatchCommand('redo')
  expect(editor.materializeFullText()).toBe('X')
  expect(editor['view']['view'].model.projection.getRow(0)?.text).toBe('X')
})

test('sparse edits and undo retain the scrolled viewport', () => {
  const editor = mountEditor()
  const text = Array.from({ length: 100 }, (_, row) => `line ${row}`).join('\n')
  editor.openDocument({ documentId: 'scrolled.txt', text })
  editor.setSelection(text.indexOf('line 17'), text.indexOf('line 17'))
  editor['view'].setScrollMetrics(400, 80, 640)
  const before = editor.getScrollPosition()
  editor.edit([
    { from: 0, to: 0, text: 'first\n' },
    { from: text.length, to: text.length, text: '\nlast' },
  ])
  expect(editor.getScrollPosition()).toEqual(before)
  editor.dispatchCommand('undo')
  expect(editor.getScrollPosition()).toEqual(before)
  expect(editor['view']['view'].model.projection.textSnapshot.materializeFullText()).toBe(text)
})

test.each([
  {
    text: 'a😀b\ncdé\nfgh',
    edits: [
      { from: 2, to: 2, text: 'Q' },
      { from: 7, to: 9, text: '\nR' },
    ],
    expected: 'aQ😀b\ncd\nR\nfgh',
  },
  {
    text: 'ab\r\ncd\r\nef',
    edits: [
      { from: 1, to: 3, text: '\r\nX' },
      { from: 6, to: 7, text: 'Y' },
    ],
    expected: 'a\nXcd\nYf',
  },
])(
  'mixed Unicode and normalized line endings render their committed batch: $text',
  ({ text, edits, expected }) => {
    const editor = mountEditor()
    editor.openDocument({ documentId: 'unicode.txt', text })
    const original = editor.materializeFullText()
    editor.edit(edits)
    expect(editor.materializeFullText()).toBe(expected)
    const projection = editor['view']['view'].model.projection
    expect(
      Array.from({ length: projection.rowCount }, (_, row) => projection.getRow(row)?.text).join(
        '\n',
      ),
    ).toBe(expected)
    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe(original)
    expect(
      Array.from({ length: projection.rowCount }, (_, row) => projection.getRow(row)?.text).join(
        '\n',
      ),
    ).toBe(original)
  },
)
