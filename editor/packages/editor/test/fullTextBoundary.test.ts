import { createEditorStructuralOperation } from '../src/editor/operationDefinitions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kind } from 'tree-sitter-md'

import { createDecodePlugin } from '../../decode/src/index'
import { createMarkdownPreviewPlugin } from '../../markdown/src/index'
import { createScopeLinesPlugin } from '../../scope-lines/src/index'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  type EditorTextBuffer,
} from '../src/documentSession'
import type { Editor } from '../src/editor'
import { createMergeConflictPlugin } from '../src/mergeConflictPlugin'
import type { EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import { serializeEditorViewSnapshot } from '../src/public/extensions'
import { setHighlightRegistry } from '../src/public/testing'
import {
  createEmptySyntaxResult,
  type EditorSyntaxCapture,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
} from '../src/syntax'
import { createVisibleEditor } from './factories/visibleEditor'

/**
 * E033: ordinary work — typing, undo, selection, scrolling, plugin delivery, snapshot reads — never
 * flattens the document. Every whole-text read is observed where the snapshot records it, so a
 * wrapper or a chunk concatenation elsewhere cannot hide one.
 */

type Diagnostic = {
  readonly name: string
  readonly detail?: Readonly<Record<string, unknown>>
}

type DiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: ((diagnostic: Diagnostic) => void) | null
}

type Reads = {
  readonly fullReads: number
  /** Units read by bounded ranges, conflict scans excluded. */
  readonly codeUnits: number
  readonly conflictScans: number
}

const HEAD = [
  '# Title',
  '',
  'Some **bold** prose and more.',
  '',
  'function outer() {',
  '  if (ready) {',
  '    return 1',
  '  }',
  '}',
  '',
].join('\n')
const BOLD_START = HEAD.indexOf('**bold**')
// A filler row past the first 4,096 units, with no replacement on it or the row after at either size.
const FILLER_ROW = 200
const REPLACEMENTS = 32

const editors: Editor[] = []
let diagnostics: Diagnostic[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
  diagnostics = []
  ;(globalThis as DiagnosticGlobal).__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) => {
    diagnostics.push(diagnostic)
  }
})

afterEach(() => {
  ;(globalThis as DiagnosticGlobal).__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('full-text boundary', () => {
  it('keeps ordinary operations off the whole document, whatever its size', async () => {
    const small = await measureOperations(65_536)
    const large = await measureOperations(1_048_576)

    for (const [operation, reads] of Object.entries(large)) {
      expect({ operation, fullReads: reads.fullReads }).toEqual({ operation, fullReads: 0 })
      // Edits since the last scan touched no marker line, so "no conflicts" carries forward.
      expect({ operation, scans: reads.conflictScans }).toEqual({ operation, scans: 0 })
      // Same visible content, same captures, same caret: a bigger document costs no more reads.
      expect({ operation, codeUnits: reads.codeUnits }).toEqual({
        operation,
        codeUnits: small[operation]!.codeUnits,
      })
      expect(reads.codeUnits).toBeLessThanOrEqual(OPERATION_READ_BUDGETS[operation]!)
    }
  })

  it('observes explicit extraction and whole-range reads at their true length', async () => {
    const { buffer, first } = await openSharedDocument(65_536)
    const length = buffer.getTextSnapshot().length

    const extracted = capture(() => first.editor.materializeFullText())
    const ranged = capture(() => first.editor.getTextSnapshot().readRange(0, length))

    expect(extracted.value).toHaveLength(length)
    expect(ranged.value).toBe(extracted.value)
    expect(fullReadLengths(extracted.diagnostics)).toEqual([length])
    expect(fullReadLengths(ranged.diagnostics)).toEqual([length])
  })

  it('serializes the revision a snapshot captured, not a later one', async () => {
    const { first } = await openSharedDocument(65_536)
    const snapshot = first.latest()
    const before = snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length)

    first.editor.edit({ from: 0, to: 0, text: 'later ' })
    await vi.runAllTimersAsync()

    expect(serializeEditorViewSnapshot(snapshot).fullText).toBe(before)
    expect(first.editor.materializeFullText()).toBe(`later ${before}`)
  })

  it('refuses flattening on every plugin entry point during delivery', async () => {
    const { buffer, first, second } = await openSharedDocument(65_536)
    const prototype = Object.getPrototypeOf(buffer.getTextSnapshot()) as {
      materializeFullText(): string
    }
    const flattened: string[] = []
    vi.spyOn(prototype, 'materializeFullText').mockImplementation(function (this: unknown) {
      flattened.push(new Error('flattened').stack ?? '')
      throw new Error('ordinary work flattened the document')
    })

    first.editor.edit({ from: HEAD.length, to: HEAD.length, text: 'x' })
    await vi.runAllTimersAsync()
    second.editor.dispatchCommand('undo')
    await vi.runAllTimersAsync()
    first.editor.setSelection(BOLD_START + 3)
    await vi.runAllTimersAsync()

    expect(flattened).toEqual([])
  })
})

// UTF-16 units one operation may read over the fixed viewport, captures and caret. Measured at both
// sizes: type 902, peerUndo 1202, select 411, commentLine 1987, moveLine 1197, deleteWord 1962,
// cutLine 1741, addNextOccurrence 1912, the rest 0.
const OPERATION_READ_BUDGETS: Readonly<Record<string, number>> = {
  type: 2_048,
  peerUndo: 2_048,
  select: 1_024,
  scroll: 1_024,
  state: 0,
  snapshots: 0,
  commentLine: 4_096,
  moveLine: 2_048,
  deleteWord: 4_096,
  cutLine: 4_096,
  addNextOccurrence: 2_048,
}

async function measureOperations(size: number): Promise<Record<string, Reads>> {
  const { first, second } = await openSharedDocument(size)
  const caret = HEAD.length
  // The first change is what makes a feature contribution scan for conflicts; that is not typing.
  first.editor.edit({ from: caret, to: caret, text: 'w' })
  second.editor.edit({ from: caret, to: caret, text: 'v' })
  await vi.runAllTimersAsync()
  const operations: Record<string, () => unknown> = {
    type: () => first.editor.edit({ from: caret, to: caret, text: 'x' }),
    peerUndo: () => second.editor.dispatchCommand('undo'),
    select: () => first.editor.setSelection(BOLD_START + 3),
    scroll: () => first.editor['view'].setScrollMetrics(96, 240, 640),
    state: () => [first.editor.getState(), second.editor.getState()],
    snapshots: () => {
      const snapshot = first.latest()
      return [{ ...snapshot }, JSON.stringify(snapshot)]
    },
    commentLine: () => first.editor.dispatchCommand('editor.action.commentLine'),
    moveLine: () => first.editor.dispatchCommand('editor.action.moveLinesDownAction'),
    deleteWord: () => first.editor.dispatchCommand('deleteWordLeft'),
    cutLine: () => cutCaretLine(first.container),
    // A caret in a filler row's `line`: the first press selects it, the second finds the next row's.
    addNextOccurrence: () => {
      first.editor.setSelection(first.editor.getTextSnapshot().lineStart(FILLER_ROW) + 8)
      expect(first.editor.dispatchCommand('addNextOccurrence')).toBe(true)
      expect(first.editor.dispatchCommand('addNextOccurrence')).toBe(true)
    },
  }

  const results: Record<string, Reads> = {}
  for (const [name, run] of Object.entries(operations)) {
    const measured = await captureAsync(async () => {
      run()
      await vi.runAllTimersAsync()
    })
    results[name] = readsOf(measured.diagnostics)
  }
  for (const editor of editors.splice(0)) editor.dispose()
  return results
}

async function openSharedDocument(size: number) {
  const buffer = fragmentedBuffer(size)
  const first = mount(buffer, 'first')
  const second = mount(buffer, 'second')
  markdownReplacements = 0
  await vi.runAllTimersAsync()
  expect(markdownReplacements).toBeGreaterThan(0)
  return { buffer, first, second }
}

// Real replacements spread through the filler, so the source is many pieces rather than one string.
function fragmentedBuffer(size: number): EditorTextBuffer {
  // Whole filler lines, so both sizes end on the same text and only the length differs.
  const line = 'filler line of plain text\n'
  const filler = line.repeat(Math.floor((size - HEAD.length) / line.length))
  const buffer = createEditorTextBuffer(`${HEAD}${filler}`)
  const session = createEditorBufferSession(buffer, createEditorViewSession(buffer, 'fragment'))
  const stride = Math.floor((size - HEAD.length) / REPLACEMENTS)
  for (let index = 0; index < REPLACEMENTS; index += 1) {
    const from = HEAD.length + index * stride + 1
    session.applyEdits([{ from, to: from + 1, text: 'I' }])
  }
  return buffer
}

function mount(buffer: EditorTextBuffer, viewId: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const snapshots: EditorViewSnapshot[] = []
  const editor = createVisibleEditor(container, {
    tabSize: 2,
    plugins: [
      markdownCaptures(),
      observedMarkdown(),
      createScopeLinesPlugin(),
      createDecodePlugin(),
      createMergeConflictPlugin(),
      recordSnapshots(snapshots),
    ],
  })
  editor['view'].setScrollMetrics(0, 240, 640)
  editor.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, viewId)), {
    documentId: 'boundary.md',
    languageId: 'markdown',
  })
  editors.push(editor)
  return { container, editor, latest: () => snapshots.at(-1)! }
}

let markdownReplacements = 0

// The real plugin, with its provider's output counted, so a provider that throws cannot pass.
function observedMarkdown(): EditorPlugin {
  const plugin = createMarkdownPreviewPlugin()
  return {
    ...plugin,
    activate: (context) =>
      plugin.activate({
        ...context,
        registerInlineReplacementProvider: (provider) =>
          context.registerInlineReplacementProvider((replacementContext) => {
            const specs = provider(replacementContext)
            markdownReplacements += specs.length
            return specs
          }),
      }),
  }
}

function recordSnapshots(snapshots: EditorViewSnapshot[]): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot) => snapshots.push(snapshot),
          dispose: () => undefined,
        }),
      }),
  }
}

// Supply the structural records consumed by the Markdown preview.
function markdownCaptures(): EditorPlugin {
  const captures: EditorSyntaxCapture[] = [
    capture_('text.strong', BOLD_START, BOLD_START + 8),
    capture_('punctuation.delimiter', BOLD_START, BOLD_START + 2),
    capture_('punctuation.delimiter', BOLD_START + 6, BOLD_START + 8),
  ]
  const result = (): EditorSyntaxResult => ({
    ...createEmptySyntaxResult(),
    captures,
    records: {
      languageId: 'markdown',
      data: new Uint32Array([BOLD_START, BOLD_START + 8, Kind.Strong, 0]),
    },
  })
  const session: EditorSyntaxRuntime = {
    analyze: async () => result(),
    foldingSupport: 'supported',
    getResult: result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose() {},
  }
  return {
    activate: (context) =>
      context.registerSyntaxProvider({ operation: createEditorStructuralOperation(() => session) }),
  }
}

function capture_(captureName: string, startIndex: number, endIndex: number): EditorSyntaxCapture {
  return { captureName, startIndex, endIndex }
}

// Nothing selected, so the cut takes the caret's whole line.
function cutCaretLine(container: HTMLElement): void {
  const event = new Event('cut', { bubbles: true, cancelable: true }) as ClipboardEvent
  const clipboardData = { getData: () => '', setData: () => undefined }
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  container.querySelector('.editor-virtualized-input')!.dispatchEvent(event)
}

function capture<T>(run: () => T): { value: T; diagnostics: Diagnostic[] } {
  const start = diagnostics.length
  const value = run()
  return { value, diagnostics: diagnostics.slice(start) }
}

async function captureAsync(run: () => Promise<void>): Promise<{ diagnostics: Diagnostic[] }> {
  const start = diagnostics.length
  await run()
  return { diagnostics: diagnostics.slice(start) }
}

function snapshotReads(entries: readonly Diagnostic[]): readonly Diagnostic[] {
  return entries.filter((diagnostic) => diagnostic.name === 'textSnapshot.read')
}

function readsOf(entries: readonly Diagnostic[]): Reads {
  let fullReads = 0
  let codeUnits = 0
  for (const read of snapshotReads(entries)) {
    fullReads += Number(read.detail?.fullTextReads ?? 0)
    codeUnits += Number(read.detail?.sourceBytesRead ?? 0) / 2
  }
  const scans = entries.filter((diagnostic) => diagnostic.name === 'mergeConflicts.scan')
  const scanned = scans.reduce((sum, scan) => sum + Number(scan.detail?.scannedCodeUnits ?? 0), 0)
  return { fullReads, codeUnits: codeUnits - scanned, conflictScans: scans.length }
}

function fullReadLengths(entries: readonly Diagnostic[]): readonly number[] {
  return snapshotReads(entries)
    .filter((read) => read.detail?.fullTextReads === 1)
    .map((read) => Number(read.detail?.sourceBytesRead ?? 0) / 2)
}
