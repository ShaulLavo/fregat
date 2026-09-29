import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DocumentSessionChange } from '../src/documentSession'
import type { Editor } from '../src/editor'
import type { EditorPlugin } from '../src/plugins'
import type { EditorHighlightResult } from '../src/syntax/highlighter'
import { setHighlightRegistry } from '../src/public/testing'
import {
  createEmptySyntaxResult,
  type EditorSyntaxResult,
  EditorTokenStore,
  type EditorSyntaxSession,
} from '../src/syntax'
import { createVisibleEditor } from './factories/visibleEditor'

type PendingResult<T> = {
  readonly change: DocumentSessionChange
  resolve(value: T): void
}

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
  vi.restoreAllMocks()
})

function enqueueResult<T>(pending: PendingResult<T>[], change: DocumentSessionChange): Promise<T> {
  return new Promise((resolve) => pending.push({ change, resolve }))
}

async function syntaxEditor() {
  const structural: PendingResult<EditorSyntaxResult>[] = []
  const highlights: PendingResult<EditorHighlightResult>[] = []
  const syntaxSession: EditorSyntaxSession = {
    refresh: async () => createEmptySyntaxResult(),
    applyChange: (change) => enqueueResult(structural, change),
    foldingSupport: 'supported',
    getResult: createEmptySyntaxResult,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose() {},
  }
  const plugin: EditorPlugin = {
    activate: (context) => {
      const syntax = context.registerSyntaxProvider({ createSession: () => syntaxSession })
      const highlight = context.registerHighlighter({
        createSession: () => ({
          refresh: async () => ({ tokens: EditorTokenStore.empty() }),
          applyChange: (change) => enqueueResult(highlights, change),
          dispose() {},
        }),
      })
      return {
        dispose: () => {
          syntax.dispose()
          highlight.dispose()
        },
      }
    },
  }
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, { plugins: [plugin] })
  editors.push(editor)
  editor['view'].setScrollMetrics(0, 240, 640)
  editor.openDocument({
    documentId: 'batch.ts',
    languageId: 'typescript',
    text: 'head\nbody\ntail',
  })
  await vi.advanceTimersByTimeAsync(200)
  return { editor, structural, highlights }
}

function editBothEnds(editor: Editor, text: string): void {
  const length = editor.getState().length
  editor.edit([
    { from: 0, to: 0, text },
    { from: length, to: length, text },
  ])
}

test('older batch syntax and highlighting cannot repaint a newer document version', async () => {
  const { editor, structural, highlights } = await syntaxEditor()
  editBothEnds(editor, 'A')
  await vi.advanceTimersByTimeAsync(200)
  editBothEnds(editor, 'B')
  await vi.advanceTimersByTimeAsync(200)
  expect(structural).toHaveLength(2)
  expect(highlights).toHaveLength(2)
  const tokens = EditorTokenStore.fromTokens([
    { start: 0, end: 2, style: { color: 'var(--editor-syntax-string)' } },
  ])
  const folds = [{ startIndex: 0, endIndex: 11, startLine: 0, endLine: 1, type: 'current' }]

  structural[1]!.resolve({ ...createEmptySyntaxResult(), folds })
  highlights[1]!.resolve({ tokens })
  await vi.advanceTimersByTimeAsync(0)
  expect(editor['tokens'].toTokens()).toEqual(tokens.toTokens())
  expect(editor['syntaxFoldProjection']()).toEqual(folds)

  structural[0]!.resolve(createEmptySyntaxResult())
  highlights[0]!.resolve({
    tokens: EditorTokenStore.fromTokens([
      { start: 5, end: 8, style: { color: 'var(--editor-syntax-comment)' } },
    ]),
  })
  await vi.advanceTimersByTimeAsync(0)

  expect(editor.materializeFullText()).toBe('BAhead\nbody\ntailAB')
  expect(editor['tokens'].toTokens()).toEqual(tokens.toTokens())
  expect(editor['syntaxFoldProjection']()).toEqual(folds)
  expect(editor['view'].getState().mountedRows[0]?.text).toBe('BAhead')
})

test('nested operations hand both committed batches to syntax once in order', async () => {
  const { editor, structural, highlights } = await syntaxEditor()
  const refresh = vi.spyOn(editor['syntax'], 'refresh')

  editor.runInOperation(() => {
    editBothEnds(editor, 'A')
    editor.runInOperation(() => editBothEnds(editor, 'B'))
  })

  const changes = refresh.mock.calls.flatMap(([, change]) => (change ? [change] : []))
  expect(changes.map((change) => change.textSnapshot.materializeFullText())).toEqual([
    'Ahead\nbody\ntailA',
    'BAhead\nbody\ntailAB',
  ])
  expect(changes.map((change) => change.edits.length)).toEqual([2, 2])
  await vi.advanceTimersByTimeAsync(200)
  // Neither session received the first batch, so each request carries both batches composed
  // against the text that session last saw rather than the second batch alone.
  const composed = {
    ...changes[1],
    edits: [
      { from: 0, to: 0, text: 'BA' },
      { from: 14, to: 14, text: 'AB' },
    ],
  }
  expect(structural.map((entry) => entry.change)).toEqual([composed])
  expect(highlights.map((entry) => entry.change)).toEqual([composed])
})

test.each(['replace', 'dispose'])('pending batch results are cancelled on %s', async (action) => {
  const { editor, structural, highlights } = await syntaxEditor()
  editBothEnds(editor, 'A')
  await vi.advanceTimersByTimeAsync(200)
  expect(structural).toHaveLength(1)
  expect(highlights).toHaveLength(1)

  if (action === 'replace') editor.openDocument({ documentId: 'new.txt', text: 'replacement' })
  if (action === 'dispose') editor.dispose()
  await vi.advanceTimersByTimeAsync(200)
  const adopt = vi.spyOn(editor['syntax'], 'setTokens')
  structural[0]!.resolve({
    ...createEmptySyntaxResult(),
    tokens: [{ start: 0, end: 2, style: {} }],
  })
  highlights[0]!.resolve({
    tokens: EditorTokenStore.fromTokens([{ start: 0, end: 2, style: { fontWeight: 700 } }]),
  })
  await vi.advanceTimersByTimeAsync(0)

  expect(adopt).not.toHaveBeenCalled()
  if (action === 'replace') expect(editor.materializeFullText()).toBe('replacement')
})
