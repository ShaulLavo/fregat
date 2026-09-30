import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Editor, EditorOptions } from '../src/editor'
import type { EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { createVisibleEditor } from './factories/visibleEditor'

const editors: Editor[] = []
const red = { color: 'red' }

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
  editors.push(editor)
  return editor
}

function snapshotRecorder(): { plugin: EditorPlugin; snapshots: EditorViewSnapshot[] } {
  const snapshots: EditorViewSnapshot[] = []
  const plugin: EditorPlugin = {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot) => snapshots.push(snapshot),
          dispose() {},
        }),
      }),
  }
  return { plugin, snapshots }
}

test('setText paints the tokens it is given, with no uncoloured update in between', () => {
  const { plugin, snapshots } = snapshotRecorder()
  const editor = mountEditor({ plugins: [plugin], documentMode: 'static' })
  editor.setText('one\ntwo', { languageId: null, tokens: [{ start: 0, end: 3, style: red }] })
  snapshots.length = 0

  editor.setText('three\nfour', { languageId: null, tokens: [{ start: 6, end: 10, style: red }] })

  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) {
    expect(snapshot.tokens.toTokens()).toEqual([{ start: 6, end: 10, style: red }])
  }
})

test('setText without tokens still clears the outgoing document’s', () => {
  const editor = mountEditor({ documentMode: 'static' })
  editor.setText('one', { languageId: null, tokens: [{ start: 0, end: 3, style: red }] })

  editor.setText('two', { languageId: null })

  expect(editor['tokens'].toTokens()).toEqual([])
})

test('syncText takes the host’s tokens over the ones it projected through the edit', () => {
  const editor = mountEditor()
  editor.setText('head\ntail', { languageId: null, tokens: [{ start: 0, end: 4, style: red }] })

  editor.syncText('head\nbody\ntail', {
    languageId: null,
    tokens: [{ start: 5, end: 9, style: red }],
  })

  expect(editor.materializeFullText()).toBe('head\nbody\ntail')
  expect(editor['tokens'].toTokens()).toEqual([{ start: 5, end: 9, style: red }])
})

test('syncText with tokens never shows the new text under the projected ones', () => {
  const { plugin, snapshots } = snapshotRecorder()
  const editor = mountEditor({ plugins: [plugin] })
  editor.setText('head\ntail', { languageId: null, tokens: [{ start: 0, end: 4, style: red }] })
  snapshots.length = 0

  editor.syncText('head\nbody\ntail', {
    languageId: null,
    tokens: [{ start: 5, end: 9, style: red }],
  })

  expect(snapshots.length).toBeGreaterThan(0)
  for (const snapshot of snapshots) {
    expect(snapshot.tokens.toTokens()).toEqual([{ start: 5, end: 9, style: red }])
  }
})
