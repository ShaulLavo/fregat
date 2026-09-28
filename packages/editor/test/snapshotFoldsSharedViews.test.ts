import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  type EditorTextBuffer,
} from '../src/documentSession'
import type { Editor } from '../src/editor'
import type { EditorViewSnapshot } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { createVisibleEditor } from './factories/visibleEditor'
import { fallbackFoldRanges } from './oracles/foldRanges'
import { createEditorSecondaryViewProjection } from '../src/public/secondaryViews'

const editors: Editor[] = []
const TEXT = 'root\n  child\n    grandchild\nnext\n  tail\nend'

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

describe('snapshot folds in shared buffer views', () => {
  it('keeps deferred secondary folds at the captured revision after edits and collapse changes', async () => {
    const buffer = createEditorTextBuffer(TEXT)
    const mounted = mount(buffer, 'deferred')
    await vi.runAllTimersAsync()
    const snapshot = mounted.snapshots.at(-1)!
    const projection = createEditorSecondaryViewProjection(snapshot)
    const capturedVersion = projection.textVersion

    mounted.editor.fold(0)
    mounted.editor.edit({ from: 0, to: 0, text: 'intro\n' })
    await vi.runAllTimersAsync()

    expect(mounted.snapshots.at(-1)!.textVersion).toBeGreaterThan(capturedVersion)
    expect(
      projection.foldSummaries.map((fold) => ({
        start: fold.startLineNumber,
        end: fold.endLineNumber,
        collapsed: fold.collapsed,
      })),
    ).toEqual([
      { start: 1, end: 3, collapsed: false },
      { start: 2, end: 3, collapsed: false },
      { start: 4, end: 5, collapsed: false },
    ])
    expect(projection.text.snapshot.readRange(0, TEXT.length)).toBe(TEXT)
  })

  it('preserves independent collapse through peer edits, undo, redo and a new history branch', async () => {
    const buffer = createEditorTextBuffer(TEXT)
    const first = mount(buffer, 'first')
    const second = mount(buffer, 'second')
    await vi.runAllTimersAsync()

    expect(first.editor.fold(0)).toBe(true)
    expect(collapsedRows(first.editor)).toEqual([0])
    expect(collapsedRows(second.editor)).toEqual([])
    expect(first.editor.getTextSnapshot()).toBe(second.editor.getTextSnapshot())

    second.editor.edit({ from: 0, to: 0, text: 'intro\n' })
    await vi.runAllTimersAsync()
    expectViews(first.editor, second.editor, buffer, `intro\n${TEXT}`, [1])

    expect(second.editor.dispatchCommand('undo')).toBe(true)
    await vi.runAllTimersAsync()
    expectViews(first.editor, second.editor, buffer, TEXT, [0])

    expect(second.editor.dispatchCommand('redo')).toBe(true)
    await vi.runAllTimersAsync()
    expectViews(first.editor, second.editor, buffer, `intro\n${TEXT}`, [1])

    expect(second.editor.dispatchCommand('undo')).toBe(true)
    await vi.runAllTimersAsync()
    second.editor.edit({ from: 0, to: 0, text: 'branch\n  leaf\n' })
    await vi.runAllTimersAsync()
    expectViews(first.editor, second.editor, buffer, `branch\n  leaf\n${TEXT}`, [2])
    expect(second.editor.getState().canRedo).toBe(false)
    const branchSnapshot = buffer.getSnapshot()
    second.editor.dispatchCommand('redo')
    expect(buffer.getSnapshot()).toBe(branchSnapshot)

    expectCoherentSnapshots(first.snapshots)
    expectCoherentSnapshots(second.snapshots)
  })

  it('finishes the surviving view when its peer is disposed during a yielded replacement build', async () => {
    const buffer = createEditorTextBuffer(TEXT)
    const first = mount(buffer, 'first')
    const second = mount(buffer, 'second')
    await vi.runAllTimersAsync()
    expect(first.editor.fold(0)).toBe(true)
    const replacement = 'header\n  child\n'.repeat(5_000)

    second.editor.edit({ from: 0, to: TEXT.length, text: replacement })
    await vi.advanceTimersByTimeAsync(150)
    expect(second.editor['fallbackFolds'].index).toBeNull()
    first.editor.dispose()
    const firstSnapshots = first.snapshots.length

    await vi.runAllTimersAsync()

    expect(second.editor['fallbackFolds'].index?.ready).toBe(true)
    expect(second.editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
    expect(second.editor.materializeFullText()).toBe(replacement)
    expect(second.editor['view'].getState().foldMarkers).toHaveLength(5_000)
    expect(collapsedRows(second.editor)).toEqual([])
    expect(first.snapshots).toHaveLength(firstSnapshots)
    expectCoherentSnapshots(second.snapshots)

    second.editor.edit({ from: replacement.length, to: replacement.length, text: 'tail\n  end' })
    await vi.runAllTimersAsync()
    expect(second.editor['view'].getState().foldMarkers).toHaveLength(5_001)
    expect(second.editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
  })
})

function mount(buffer: EditorTextBuffer, viewId: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const snapshots: EditorViewSnapshot[] = []
  const editor = createVisibleEditor(container, {
    tabSize: 2,
    plugins: [
      {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot) => snapshots.push(snapshot),
              dispose: () => undefined,
            }),
          }),
      },
    ],
  })
  editor['view'].setScrollMetrics(0, 240, 640)
  editor.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, viewId)), {
    documentId: 'shared.txt',
    languageId: null,
  })
  editors.push(editor)
  return { editor, snapshots }
}

function collapsedRows(editor: Editor): number[] {
  return editor['view']
    .getState()
    .foldMarkers.filter((marker) => marker.collapsed)
    .map((marker) => marker.startRow)
}

function expectViews(
  first: Editor,
  second: Editor,
  buffer: EditorTextBuffer,
  text: string,
  firstCollapsedRows: readonly number[],
): void {
  expect(first.getTextSnapshot()).toBe(buffer.getTextSnapshot())
  expect(second.getTextSnapshot()).toBe(buffer.getTextSnapshot())
  expect(first.materializeFullText()).toBe(text)
  expect(second.materializeFullText()).toBe(text)
  expect(collapsedRows(first)).toEqual(firstCollapsedRows)
  expect(collapsedRows(second)).toEqual([])
  expect(first['view'].getState().foldMarkers.map((marker) => marker.key)).toEqual(
    second['view'].getState().foldMarkers.map((marker) => marker.key),
  )
}

function expectCoherentSnapshots(snapshots: readonly EditorViewSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.foldMarkers.length === 0) continue
    const folds = fallbackFoldRanges({
      text: snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length),
      languageId: snapshot.languageId,
      tabSize: snapshot.tabSize,
    })
    expect(snapshot.foldMarkers.map((marker) => [marker.startOffset, marker.endOffset])).toEqual(
      folds.map((fold) => [fold.startIndex, fold.endIndex]),
    )
  }
}
