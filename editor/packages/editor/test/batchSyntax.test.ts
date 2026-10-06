import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DocumentRead } from '../src/editor/documentDelivery'
import type { DocumentChangesSinceSyncPoint } from '../src/editor/editChain'
import {
  createEditorStructuralOperation,
  createEditorHighlighterOperation,
} from '../src/editor/operationDefinitions'
import { waitForDocumentWork } from '../src/editor/documentWork'
import type { Editor } from '../src/editor'
import type { EditorPlugin } from '../src/plugins'
import type { EditorHighlightResult } from '../src/syntax/highlighter'
import { setHighlightRegistry } from '../src/public/testing'
import { createEmptySyntaxResult, type EditorSyntaxResult, EditorTokenStore } from '../src/syntax'
import { createVisibleEditor } from './factories/visibleEditor'

type PendingResult<T> = {
  readonly read: DocumentRead
  readonly changes: DocumentChangesSinceSyncPoint
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

function enqueueResult<T>(
  pending: PendingResult<T>[],
  read: DocumentRead,
  changes: DocumentChangesSinceSyncPoint,
  signal: AbortSignal,
): Promise<T> {
  const result = new Promise<T>((resolve) => pending.push({ read, changes, resolve }))
  return waitForDocumentWork(result, signal)
}

async function syntaxEditor() {
  const structural: PendingResult<EditorSyntaxResult>[] = []
  const highlights: PendingResult<EditorHighlightResult>[] = []
  const structuralOperation = createEditorStructuralOperation((context) => ({
    analyze: (read, signal) =>
      read.revision === context.initialRead.revision
        ? Promise.resolve(createEmptySyntaxResult())
        : enqueueResult(
            structural,
            read,
            context.source.changesBetween(context.initialRead.revision, read.revision)!,
            signal,
          ),
    foldingSupport: 'supported',
    getResult: createEmptySyntaxResult,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose() {},
  }))
  const highlighterOperation = createEditorHighlighterOperation((context) => ({
    analyze: (read, signal) =>
      read.revision === context.initialRead.revision
        ? Promise.resolve({ tokens: EditorTokenStore.empty() })
        : enqueueResult(
            highlights,
            read,
            context.source.changesBetween(context.initialRead.revision, read.revision)!,
            signal,
          ),
    dispose() {},
  }))
  const plugin: EditorPlugin = {
    activate: (context) => [
      context.registerSyntaxProvider({ operation: structuralOperation }),
      context.registerHighlighter({ operation: highlighterOperation }),
    ],
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
  const composed = {
    logicalRevisionCount: 2,
    edits: [
      { from: 0, to: 0, text: 'BA' },
      { from: 14, to: 14, text: 'AB' },
    ],
  }
  expect(structural).toHaveLength(1)
  expect(highlights).toHaveLength(1)
  for (const entry of [structural[0]!, highlights[0]!]) {
    expect(entry.changes).toMatchObject(composed)
    expect(entry.read.text.readRange(0, entry.read.text.length)).toBe('BAhead\nbody\ntailAB')
    expect(entry.read.revision.point.revision).toBe(2)
  }
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
