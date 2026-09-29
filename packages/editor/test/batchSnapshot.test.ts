import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import type { TextReadSnapshot } from '../src/documentTextSnapshot'
import type { Editor, EditorOptions } from '../src/editor'
import type { DocumentSyncPoint } from '../src/editor/editChain'
import type { EditorViewSnapshot } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
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

test('shared-view snapshots publish text, selections and synchronization from one generation', () => {
  const buffer = createEditorTextBuffer('alpha\nbeta\ngamma')
  const committedPoints = new Map<TextReadSnapshot, DocumentSyncPoint>()
  buffer.subscribe(({ change }) =>
    committedPoints.set(change.textSnapshot, buffer.getDocumentSyncPoint()),
  )
  const snapshots: EditorViewSnapshot[] = []
  const first = mountEditor()
  let reentered = false
  const second = mountEditor({
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit([
        { from: 0, to: 0, text: 'X'.repeat(20) },
        { from: 6, to: 6, text: 'Y'.repeat(20) },
      ])
    },
  })
  const third = mountEditor({
    plugins: [
      {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot, _kind, change) => {
                if (change?.kind === 'edit') snapshots.push(snapshot)
              },
              dispose() {},
            }),
          }),
      },
    ],
  })
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  third.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'third')))
  third.setSelection(buffer.getSnapshot().length)
  const initialPoint = buffer.getDocumentSyncPoint()

  first.edit([
    { from: 0, to: 1, text: 'A' },
    { from: 11, to: 12, text: 'G' },
  ])

  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) {
    expect(snapshot.documentSyncPoint).toEqual(committedPoints.get(snapshot.textSnapshot))
    expect(snapshot.changesSinceDocumentSyncPoint(initialPoint, null)?.syncPointAfter).toEqual(
      snapshot.documentSyncPoint,
    )
    expect(
      snapshot.selections.every(
        (selection) => selection.headOffset <= snapshot.textSnapshot.length,
      ),
    ).toBe(true)
  }
  for (const editor of [first, second, third]) {
    expect(editor['view']['view'].model.textSnapshot).toBe(buffer.getTextSnapshot())
  }
})
