import { waitForDocumentWork } from '../src/editor/documentWork'
import { createEditorHighlighterOperation } from '../src/editor/operationDefinitions'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  type DocumentSessionChange,
} from '../src/documentSession'
import type { Editor, EditorOptions } from '../src/editor'
import type { EditorHighlightResult } from '../src/syntax/highlighter'
import {
  recordEditorPerformanceDiagnostic,
  type EditorPerformanceDiagnostic,
} from '../src/editor/performanceDiagnostics'
import { setHighlightRegistry } from '../src/public/testing'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { createVisibleEditor } from './factories/visibleEditor'

const editors: Editor[] = []
const records: EditorPerformanceDiagnostic[] = []

beforeEach(() => {
  records.length = 0
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) =>
    records.push(event),
  )
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test.each([
  { commands: ['undo'] as const, text: 'abc' },
  { commands: ['undo', 'redo'] as const, text: 'aXbc' },
])(
  'batched commands $commands share their owning flush and deferred origin',
  async ({ commands, text }) => {
    vi.useFakeTimers()
    const editor = mountEditor()
    editor.openDocument({ documentId: 'batch.txt', text: 'abc' })
    editor.edit({ from: 1, to: 1, text: 'X' })
    // Keep the fold index cold so the batch schedules deferred work.
    records.length = 0

    editor.runInOperation(() => {
      for (const command of commands) editor.dispatchCommand(command)
      expect(records.filter((event) => event.name === 'editor.input')).toHaveLength(0)
    })
    recordEditorPerformanceDiagnostic('outside-batch')
    await vi.runAllTimersAsync()

    expect(editor.materializeFullText()).toBe(text)
    const inputs = records.filter((event) => event.name === 'editor.input')
    expect(inputs).toHaveLength(1)
    const input = inputs[0]
    expect(input?.operation?.input).toBe('editor.operation')
    const commits = records.filter((event) => event.name === 'editor.document.committed')
    const updates = records.filter((event) => event.name === 'editor.view.updated')
    expect(commits).toHaveLength(commands.length)
    expect(updates).toHaveLength(1)
    expect(
      commits.concat(updates).every((event) => event.operation?.id === input?.operation?.id),
    ).toBe(true)
    expect(input?.timestampMs).toBeGreaterThanOrEqual(updates[0]?.timestampMs ?? Infinity)
    const deferred = records.filter((event) => event.name === 'editor.secondary.folds')
    expect(deferred).toHaveLength(1)
    expect(deferred[0]?.operation).toEqual(input?.operation)
    expect(records.find((event) => event.name === 'outside-batch')).not.toHaveProperty('operation')
  },
)

test.each(['body', 'flush'] as const)(
  'a batch restores context when its %s throws',
  (failureAt) => {
    const failure = Symbol('batch failure')
    let rejectFlush = false
    const editor = mountEditor({
      onChange: (_state, change) => {
        if (change && rejectFlush) throw failure
      },
    })
    editor.openDocument({ documentId: 'batch.txt', text: 'abc' })
    editor.edit({ from: 1, to: 1, text: 'X' })
    records.length = 0
    rejectFlush = failureAt === 'flush'

    expect(() =>
      editor.runInOperation(() => {
        editor.runInOperation(() => editor.dispatchCommand('undo'))
        if (failureAt === 'body') throw failure
      }),
    ).toThrow(failure)
    recordEditorPerformanceDiagnostic('after-failure')

    const inputs = records.filter((event) => event.name === 'editor.input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.operation?.input).toBe('editor.operation')
    expect(records.find((event) => event.name === 'after-failure')).not.toHaveProperty('operation')
    rejectFlush = false
    editor.dispatchCommand('redo')
    expect(editor.materializeFullText()).toBe('aXbc')
    expect(records.filter((event) => event.name === 'editor.input').at(-1)?.operation?.input).toBe(
      'redo',
    )
  },
)

test.each([false, true])(
  'a shared-buffer command joins the owning batch through both views (reentrant peer: %s)',
  async (reentrantPeer) => {
    vi.useFakeTimers()
    const buffer = createEditorTextBuffer('abc')
    const first = mountEditor()
    const second = mountEditor({
      onChange: (_state, change) => {
        if (reentrantPeer && change?.kind === 'undo') second.dispatchCommand('redo')
      },
    })
    first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
    second.attachSession(
      createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')),
    )
    first.edit({ from: 1, to: 1, text: 'X' })
    // Keep both fold indexes cold so each view schedules deferred work.
    records.length = 0

    first.runInOperation(() => second.dispatchCommand('undo'))
    recordEditorPerformanceDiagnostic('outside-shared-batch')
    await vi.runAllTimersAsync()

    const expectedText = reentrantPeer ? 'aXbc' : 'abc'
    expect(first.materializeFullText()).toBe(expectedText)
    expect(second.materializeFullText()).toBe(expectedText)
    const inputs = records.filter((event) => event.name === 'editor.input')
    expect(inputs).toHaveLength(1)
    const operation = inputs[0]?.operation
    expect(operation?.input).toBe('editor.operation')
    const commits = records.filter((event) => event.name === 'editor.document.committed')
    const updates = records.filter((event) => event.name === 'editor.view.updated')
    expect(commits).toHaveLength(reentrantPeer ? 4 : 2)
    expect(updates).toHaveLength(reentrantPeer ? 3 : 2)
    expect(new Set(updates.map((event) => event.view?.id)).size).toBe(2)
    expect(commits.concat(updates).every((event) => event.operation === operation)).toBe(true)
    expect(inputs[0]?.timestampMs).toBeGreaterThanOrEqual(
      Math.max(...updates.map((event) => event.timestampMs)),
    )
    const deferred = records.filter((event) => event.name === 'editor.secondary.folds')
    expect(deferred).toHaveLength(2)
    expect(deferred.every((event) => event.operation === operation)).toBe(true)
    expect(records.find((event) => event.name === 'outside-shared-batch')).not.toHaveProperty(
      'operation',
    )
  },
)

test('a no-op batch ends once and restores context', () => {
  const editor = mountEditor()
  editor.openDocument({ documentId: 'batch.txt', text: 'abc' })
  records.length = 0
  editor.runInOperation(() => editor.runInOperation(() => undefined))
  recordEditorPerformanceDiagnostic('outside-batch')
  const inputs = records.filter((event) => event.name === 'editor.input')
  expect(inputs).toHaveLength(1)
  expect(inputs[0]?.operation?.input).toBe('editor.operation')
  expect(records.some((event) => event.name === 'editor.view.updated')).toBe(false)
  expect(records.find((event) => event.name === 'outside-batch')).not.toHaveProperty('operation')
})

test.each(['command', 'batch'] as const)(
  'a reentrant %s has its own pass and restores the enclosing batch identity',
  (kind) => {
    const editor = mountEditor({
      onChange: (_state, change) => {
        if (change?.kind !== 'undo') return
        if (kind === 'batch') editor.runInOperation(() => editor.dispatchCommand('redo'))
        else editor.dispatchCommand('redo')
        recordEditorPerformanceDiagnostic('after-reentrant-command')
      },
    })
    editor.openDocument({ documentId: 'batch.txt', text: 'abc' })
    editor.edit({ from: 1, to: 1, text: 'X' })
    records.length = 0
    editor.runInOperation(() => editor.dispatchCommand('undo'))
    recordEditorPerformanceDiagnostic('outside-batch')

    expect(editor.materializeFullText()).toBe('aXbc')
    const inputs = records.filter((event) => event.name === 'editor.input')
    expect(inputs.map((event) => event.operation?.input)).toEqual([
      kind === 'batch' ? 'editor.operation' : 'redo',
      'editor.operation',
    ])
    expect(inputs[0]?.operation?.id).not.toBe(inputs[1]?.operation?.id)
    const updates = records.filter((event) => event.name === 'editor.view.updated')
    expect(updates.map((event) => event.operation?.id)).toEqual(
      inputs.map((event) => event.operation?.id),
    )
    expect(records.find((event) => event.name === 'after-reentrant-command')?.operation).toEqual(
      inputs[1]?.operation,
    )
    expect(records.find((event) => event.name === 'outside-batch')).not.toHaveProperty('operation')
  },
)

function insert(editor: Editor, data: string): void {
  editor.getInputElement().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    }),
  )
}

function mountEditor(options: EditorOptions = {}): Editor {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, options)
  editors.push(editor)
  return editor
}

test('a native edit and undo correlate both affected views with the committed shared revision', () => {
  const buffer = createEditorTextBuffer('abc')
  const first = mountEditor()
  const second = mountEditor()
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  first.setSelection(1)
  records.length = 0
  insert(first, 'X')

  expect(first.materializeFullText()).toBe('aXbc')
  expect(second.materializeFullText()).toBe('aXbc')
  expect((first.getInputElement() as HTMLTextAreaElement).selectionStart).toBe(2)
  const commits = records.filter((event) => event.name === 'editor.document.committed')
  const layouts = records.filter((event) => event.name === 'editor.view.updated')
  const input = records.find((event) => event.name === 'editor.input')
  expect(commits).toHaveLength(2)
  expect(layouts).toHaveLength(2)
  expect(new Set(commits.map((event) => event.view?.id)).size).toBe(2)
  expect(commits.every((event) => event.operation?.id === input?.operation?.id)).toBe(true)
  expect(layouts.every((event) => event.operation?.id === input?.operation?.id)).toBe(true)
  expect(commits.every((event) => event.view?.revision === buffer.getRevision())).toBe(true)
  expect(input?.timestampMs).toBeGreaterThanOrEqual(
    Math.max(...layouts.map((event) => event.timestampMs)),
  )

  records.length = 0
  expect(first.dispatchCommand('undo')).toBe(true)
  expect(first.materializeFullText()).toBe('abc')
  expect(second.materializeFullText()).toBe('abc')
  expect((first.getInputElement() as HTMLTextAreaElement).selectionStart).toBe(1)
  expect(records.find((event) => event.name === 'editor.input')).toMatchObject({
    operation: { input: 'undo' },
  })
  expect(records.filter((event) => event.name === 'editor.view.updated')).toHaveLength(2)
})

test('composition preedit stays native and only its final text commits', () => {
  const editor = mountEditor()
  editor.openDocument({ documentId: 'composition.txt', text: 'abc' })
  editor.setSelection(1)
  const input = editor.getInputElement() as HTMLTextAreaElement
  records.length = 0
  input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
  const update = new Event('compositionupdate', { bubbles: true })
  Object.defineProperty(update, 'data', { value: 'に' })
  input.dispatchEvent(update)
  expect(editor.materializeFullText()).toBe('abc')
  expect(records.some((event) => event.name === 'editor.document.committed')).toBe(false)
  const end = new Event('compositionend', { bubbles: true })
  Object.defineProperty(end, 'data', { value: '日本' })
  input.dispatchEvent(end)
  expect(editor.materializeFullText()).toBe('a日本bc')
  expect(input.selectionStart).toBe(3)
  expect(records.find((event) => event.name === 'editor.document.committed')).toMatchObject({
    operation: { input: 'input.compositionend' },
    detail: { timingName: 'editor.bufferChange' },
  })
})

test('coalesced secondary work retains only the latest origin and is cancelled on document switch and disposal', async () => {
  vi.useFakeTimers()
  const editor = mountEditor()
  editor.openDocument({ documentId: 'first.txt', text: 'abc' })
  await vi.runAllTimersAsync()
  records.length = 0
  insert(editor, 'X')
  insert(editor, 'Y')
  const inputs = records.filter((event) => event.name === 'editor.input')
  await vi.runAllTimersAsync()
  const secondary = records.filter((event) => event.name === 'editor.secondary.features')
  expect(secondary).toHaveLength(1)
  expect(secondary[0]?.operation?.id).toBe(inputs.at(-1)?.operation?.id)
  expect(secondary[0]?.view?.revision).toBe(2)

  records.length = 0
  insert(editor, 'Z')
  editor.openDocument({ documentId: 'second.txt', text: 'replacement' })
  await vi.runAllTimersAsync()
  expect(editor.materializeFullText()).toBe('replacement')
  expect(records.filter((event) => event.name === 'editor.secondary.features')).toHaveLength(0)

  records.length = 0
  insert(editor, 'Q')
  editor.dispose()
  await vi.runAllTimersAsync()
  expect(records.filter((event) => event.name === 'editor.secondary.features')).toHaveLength(0)
})

test.each(['open', 'attach', 'clear', 'detach'] as const)(
  'rejects all outgoing secondary events after %s changes document ownership',
  async (boundary) => {
    vi.useFakeTimers()
    const editor = mountEditor()
    editor.openDocument({ documentId: 'outgoing.txt', text: 'abc' })
    await vi.runAllTimersAsync()
    records.length = 0
    insert(editor, 'X')
    const operationId = records.find((event) => event.name === 'editor.input')?.operation?.id
    expect(operationId).toBeDefined()
    if (boundary === 'open') editor.openDocument({ documentId: 'incoming.txt', text: 'new' })
    if (boundary === 'attach')
      editor.attachSession(createEditorBufferSession(createEditorTextBuffer('new')))
    if (boundary === 'clear') editor.clear()
    if (boundary === 'detach') editor.detachSession()
    await vi.runAllTimersAsync()
    expect(
      records.filter(
        (event) =>
          event.operation?.id === operationId && event.name.startsWith('editor.secondary.'),
      ),
    ).toEqual([])
  },
)

test('late highlighter results keep their origin and cannot apply after newer edits, replacement, or disposal', async () => {
  vi.useFakeTimers()
  const pending: Array<(result: EditorHighlightResult) => void> = []
  const disposed = vi.fn()
  const applyChange = () => new Promise<EditorHighlightResult>((resolve) => pending.push(resolve))
  const operation = createEditorHighlighterOperation((context) => ({
    analyze: (read, signal) =>
      read.revision === context.initialRead.revision
        ? Promise.resolve({ tokens: EditorTokenStore.empty() })
        : waitForDocumentWork(applyChange(), signal),
    dispose: disposed,
  }))
  const editor = mountEditor({
    plugins: [{ activate: (context) => context.registerHighlighter({ operation }) }],
  })
  editor.openDocument({ documentId: 'first.txt', text: 'abc' })
  await vi.runAllTimersAsync()
  records.length = 0
  insert(editor, 'X')
  await vi.runAllTimersAsync()
  insert(editor, 'Y')
  await vi.runAllTimersAsync()
  expect(pending).toHaveLength(2)
  const inputs = records.filter((event) => event.name === 'editor.input')
  pending[0]?.({ tokens: EditorTokenStore.empty() })
  await vi.runAllTimersAsync()
  expect(records.filter((event) => event.name === 'editor.syntax.highlight.accepted')).toHaveLength(
    0,
  )
  pending[1]?.({ tokens: EditorTokenStore.empty() })
  await vi.runAllTimersAsync()
  expect(records.find((event) => event.name === 'editor.syntax.highlight.accepted')).toMatchObject({
    operation: { id: inputs.at(-1)?.operation?.id },
    view: { revision: 2 },
  })

  records.length = 0
  insert(editor, 'Z')
  await vi.runAllTimersAsync()
  editor.openDocument({ documentId: 'second.txt', text: 'replacement' })
  pending[2]?.({ tokens: EditorTokenStore.empty() })
  await vi.runAllTimersAsync()
  expect(editor.materializeFullText()).toBe('replacement')
  expect(
    records.filter((event) => event.name === 'editor.syntax.highlight.accepted' && event.operation),
  ).toHaveLength(0)
  expect(disposed).toHaveBeenCalledOnce()

  records.length = 0
  insert(editor, 'Q')
  await vi.runAllTimersAsync()
  expect(pending).toHaveLength(4)
  editor.dispose()
  pending[3]?.({ tokens: EditorTokenStore.empty() })
  await vi.runAllTimersAsync()
  expect(records.filter((event) => event.name === 'editor.syntax.highlight.accepted')).toHaveLength(
    0,
  )
  expect(disposed).toHaveBeenCalledTimes(2)
})

test.each(['open', 'attach', 'detach', 'open-and-edit'] as const)(
  'rejects outgoing secondary callbacks when onChange performs %s and preserves replacement work',
  async (boundary) => {
    vi.useFakeTimers()
    const received: Array<{ documentId: string | null; text: string }> = []
    const handleEditorChange = (change: DocumentSessionChange | null) => {
      if (!change?.edits.length) return
      received.push({
        documentId: editor.getState().documentId,
        text: change.edits.map((edit) => edit.text).join(''),
      })
    }
    const contribution = { handleEditorChange, dispose: vi.fn() }
    const editor = mountEditor({
      onChange: (_state, change) => {
        if (change?.edits[0]?.text !== 'X') return
        if (boundary === 'detach') return editor.detachSession()
        if (boundary === 'attach') {
          editor.attachSession(createEditorBufferSession(createEditorTextBuffer('new')), {
            documentId: 'incoming.txt',
          })
          return
        }
        editor.openDocument({ documentId: 'incoming.txt', text: 'new' })
        if (boundary === 'open-and-edit') insert(editor, 'Y')
      },
      plugins: [
        {
          activate: (context) =>
            context.registerDecorationContribution({ createContribution: () => contribution }),
        },
      ],
    })
    editor.openDocument({ documentId: 'outgoing.txt', text: 'old' })
    await vi.runAllTimersAsync()
    records.length = 0
    insert(editor, 'X')
    const outgoing = records.find(
      (event) =>
        event.name === 'editor.document.committed' && event.view?.documentId === 'outgoing.txt',
    )
    expect(outgoing?.operation).toBeDefined()
    await vi.runAllTimersAsync()
    expect(
      records.filter(
        (event) =>
          event.name.startsWith('editor.secondary.') &&
          event.operation?.id === outgoing?.operation?.id,
      ),
    ).toEqual([])
    const expected = boundary === 'open-and-edit' ? [{ documentId: 'incoming.txt', text: 'Y' }] : []
    expect(received).toEqual(expected)
  },
)
