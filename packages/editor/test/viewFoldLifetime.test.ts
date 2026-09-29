import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { createFoldSessionEditor } from './factories/foldSessionEditor'
import { createEditorPreparedDocument } from '../src/editor/preparedDocument'

const mounted: ReturnType<typeof createFoldSessionEditor>[] = []

beforeEach(() => {
  resetEditorInstanceCount()
  setHighlightRegistry({ set: () => undefined, delete: () => true })
})

afterEach(() => {
  for (const view of mounted) view.dispose()
  mounted.length = 0
  setHighlightRegistry(undefined)
})

test('keeps the collapsed view across dispose, remount, and switching documents', async () => {
  const buffer = createEditorTextBuffer('before\nif (ready) {\n  work();\n}\nafter')
  const session = createEditorBufferSession(buffer)
  const initial = createFoldSessionEditor(session)
  mounted.push(initial)
  expect(initial.editor.fold(7)).toBe(true)
  expect(session.view.getFoldState().collapsedRegions).toHaveLength(1)
  initial.dispose()

  const restored = createFoldSessionEditor(session)
  mounted.push(restored)
  await vi.waitFor(() => expect(restored.markers().some((marker) => marker.collapsed)).toBe(true))

  const other = createEditorBufferSession(createEditorTextBuffer('other\n  child\nend'))
  restored.editor.attachSession(other)
  await vi.waitFor(() => expect(restored.markers().every((marker) => !marker.collapsed)).toBe(true))
  expect(other.view.getFoldState().collapsedRegions).toHaveLength(0)
  restored.editor.attachSession(session)
  await vi.waitFor(() => expect(restored.markers().some((marker) => marker.collapsed)).toBe(true))
})

test('copies the current collapse and then folds each view independently', async () => {
  const buffer = createEditorTextBuffer('before\nif (ready) {\n  work();\n}\nafter')
  const source = createEditorBufferSession(buffer)
  const first = createFoldSessionEditor(source)
  mounted.push(first)
  expect(first.editor.fold(7)).toBe(true)
  const copiedView = createEditorViewSession(buffer, 'copied')
  copiedView.acceptBufferSelections(source.view.getSelections())
  copiedView.setFoldState(source.view.getFoldState())
  const copied = createFoldSessionEditor(createEditorBufferSession(buffer, copiedView))
  mounted.push(copied)
  await vi.waitFor(() => expect(copied.markers().some((marker) => marker.collapsed)).toBe(true))

  expect(first.editor.unfoldAll()).toBe(true)
  expect(source.view.getFoldState().collapsedRegions).toHaveLength(0)
  expect(copiedView.getFoldState().collapsedRegions).toHaveLength(1)
  expect(copied.markers().some((marker) => marker.collapsed)).toBe(true)
  expect(copied.editor.unfoldAll()).toBe(true)
  expect(first.editor.fold(7)).toBe(true)
  expect(copiedView.getFoldState().collapsedRegions).toHaveLength(0)
})

test('restores a collapse when attachment adopts a prepared document', async () => {
  const buffer = createEditorTextBuffer('before\nif (ready) {\n  work();\n}\nafter')
  const session = createEditorBufferSession(buffer)
  const initial = createFoldSessionEditor(session)
  mounted.push(initial)
  expect(initial.editor.fold(7)).toBe(true)
  initial.dispose()
  const prepared = createEditorPreparedDocument({
    buffer,
    analysis: createEditorDocumentAnalysis({ buffer, documentId: 'file.ts' }),
    configuredTabSize: 4,
    tabSizePolicy: 'detect-indentation',
    documentConfigurationTag: [],
    documentId: 'file.txt',
    languageId: null,
  })
  const take = vi.spyOn(prepared, 'borrow')
  const restored = createFoldSessionEditor(session, {
    documentId: 'file.txt',
    preparedDocument: prepared,
  })
  mounted.push(restored)

  expect(take).toHaveReturnedWith(expect.objectContaining({ fallbackFoldIndex: expect.anything() }))
  await vi.waitFor(() => expect(restored.markers().some((marker) => marker.collapsed)).toBe(true))
  prepared.dispose()
})

test('restores a manual fold after the shared buffer changes while its view is unmounted', async () => {
  const text = 'intro\nalpha\nbravo\ncharlie\noutro'
  const buffer = createEditorTextBuffer(text)
  const session = createEditorBufferSession(buffer)
  const initial = createFoldSessionEditor(session)
  mounted.push(initial)
  initial.editor.setSelection(text.indexOf('alpha'), text.indexOf('\noutro'))
  expect(initial.editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(true)
  expect(session.view.getFoldState().manualFolds).toHaveLength(1)
  initial.dispose()

  const other = createEditorBufferSession(buffer)
  other.applyEdits([{ from: 0, to: 0, text: 'inserted\n' }])
  const restored = createFoldSessionEditor(session)
  mounted.push(restored)
  await vi.waitFor(() =>
    expect(restored.markers()).toMatchObject([{ startRow: 2, endRow: 4, collapsed: true }]),
  )
  const copiedView = createEditorViewSession(buffer, 'copied-manual')
  copiedView.acceptBufferSelections(session.view.getSelections())
  copiedView.setFoldState(session.view.getFoldState())
  const copied = createFoldSessionEditor(createEditorBufferSession(buffer, copiedView))
  mounted.push(copied)
  await vi.waitFor(() =>
    expect(copied.markers()).toMatchObject([{ startRow: 2, endRow: 4, collapsed: true }]),
  )
  expect(restored.editor.unfoldAll()).toBe(true)
  expect(session.view.getFoldState().manualFolds).toHaveLength(1)
  restored.editor.setSelection(buffer.materializeFullText().indexOf('alpha'))
  expect(restored.editor.dispatchCommand('editor.removeManualFoldingRanges')).toBe(true)
  expect(session.view.getFoldState().manualFolds).toHaveLength(0)
  expect(copiedView.getFoldState().manualFolds).toHaveLength(1)
  expect(copiedView.getFoldState().collapsedRegions).toHaveLength(1)
})

test('does not resurrect a manual region deleted while the view was unmounted', async () => {
  const text = 'intro\nalpha\nbravo\ncharlie\noutro'
  const buffer = createEditorTextBuffer(text)
  const session = createEditorBufferSession(buffer)
  const initial = createFoldSessionEditor(session)
  mounted.push(initial)
  initial.editor.setSelection(text.indexOf('alpha'), text.indexOf('\noutro'))
  expect(initial.editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(true)
  initial.dispose()
  createEditorBufferSession(buffer).applyEdits([
    { from: text.indexOf('alpha'), to: text.indexOf('outro'), text: '' },
  ])

  const restored = createFoldSessionEditor(session)
  mounted.push(restored)
  await vi.waitFor(() => expect(restored.markers()).toEqual([]))
  expect(restored.editor.unfoldAll()).toBe(false)
})
