import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import type { Editor } from '../src/editor'
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

test.each([
  { text: 'XAbc!', revision: 3 },
  { text: 'Abc', revision: 3 },
  { text: 'XAbc', revision: 2 },
])('syncText uses the queued buffer contents when synchronizing to $text', ({ text, revision }) => {
  const buffer = createEditorTextBuffer('abc')
  const first = createVisibleEditor(document.body.appendChild(document.createElement('div')))
  let reentered = false
  const second = createVisibleEditor(document.body.appendChild(document.createElement('div')), {
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit([{ from: 0, to: 0, text: 'X' }])
      second.syncText(text)
    },
  })
  editors.push(first, second)
  for (const editor of editors) editor['view'].setScrollMetrics(0, 240, 640)
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))

  first.edit([{ from: 0, to: 1, text: 'A' }])

  expect(buffer.materializeFullText()).toBe(text)
  expect(buffer.getRevision()).toBe(revision)
  for (const editor of editors) {
    expect(editor.materializeFullText()).toBe(text)
    expect(editor['view'].contentElement.textContent).toBe(text)
  }
})

test('snapshot-based edits use the current buffer while source publication is queued', () => {
  const buffer = createEditorTextBuffer('abc')
  const first = createVisibleEditor(document.body.appendChild(document.createElement('div')))
  let reentered = false
  let snapshotText: string | null = null
  const second = createVisibleEditor(document.body.appendChild(document.createElement('div')), {
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit({ from: 0, to: 0, text: 'PREFIX' })
      const snapshot = second.getTextSnapshot()
      snapshotText = snapshot.materializeFullText()
      second.edit({ from: snapshot.length, to: snapshot.length, text: '!' })
    },
  })
  editors.push(first, second)
  for (const editor of editors) editor['view'].setScrollMetrics(0, 240, 640)
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))

  first.edit([{ from: 0, to: 1, text: 'A' }])

  expect(snapshotText).toBe('PREFIXAbc')
  expect(buffer.materializeFullText()).toBe('PREFIXAbc!')
  for (const editor of editors) expect(editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
})
