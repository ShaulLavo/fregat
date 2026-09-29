import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { afterEach, expect, test } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import type { EditorHighlightResult, EditorPlugin } from '@singapore-editor/core/extensions'
import { createScopeLinesPlugin } from '../src/index'
import '@singapore-editor/core/style.css'

const editors: Editor[] = []
const elements: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const element of elements.splice(0)) element.remove()
})

test('native capture retains committed guide paint and replaces it synchronously with real guides', async () => {
  const source = 'function start() {\n  const one = 1\n  const two = 2\n}\n'
  const original = mount([createScopeLinesPlugin()])
  original.editor.openDocument({ text: source, documentId: 'file-a', languageId: 'typescript' })
  await expect
    .poll(() => original.host.querySelectorAll('.editor-scope-line').length)
    .toBeGreaterThan(0)
  const capture = original.editor.captureSnapshot()
  expect(capture).not.toBeNull()
  if (!capture) return

  let resolve: (result: EditorHighlightResult) => void = () => undefined
  const pending = new Promise<EditorHighlightResult>((complete) => {
    resolve = complete
  })
  const highlighter: EditorPlugin = {
    activate: (context) =>
      context.registerHighlighter({
        createSession: () => ({ refresh: () => pending, applyChange: () => pending, dispose() {} }),
      }),
  }
  const restored = mount([createScopeLinesPlugin(), highlighter], capture.paint)
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(restored.host.querySelectorAll('[data-editor-saved-paint-layer]').length).toBeGreaterThan(
    0,
  )
  expect(restored.host.querySelectorAll('.editor-scope-line')).toHaveLength(0)
  restored.editor.openDocument({ text: source, documentId: 'file-a', languageId: 'typescript' })
  expect(restored.editor.getPresentationState()).toBe('provisional')
  resolve({ tokens: EditorTokenStore.empty() })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(restored.host.querySelectorAll('[data-editor-saved-paint-layer]')).toHaveLength(0)
  expect(restored.host.querySelectorAll('.editor-scope-line').length).toBeGreaterThan(0)
  expect(restored.editor.captureSnapshot()).not.toBeNull()
})

test('late admission hides already mounted guides until authoritative takeover', async () => {
  const source = 'function start() {\n  const one = 1\n  const two = 2\n}\n'
  const original = mount([createScopeLinesPlugin()])
  original.editor.openDocument({ text: source, documentId: 'file-a', languageId: 'typescript' })
  await expect
    .poll(() => original.host.querySelectorAll('.editor-scope-line').length)
    .toBeGreaterThan(0)
  const capture = original.editor.captureSnapshot()
  expect(capture).not.toBeNull()
  if (!capture) return

  let resolve: (result: EditorHighlightResult) => void = () => undefined
  const pending = new Promise<EditorHighlightResult>((complete) => {
    resolve = complete
  })
  const highlighter: EditorPlugin = {
    activate: (context) =>
      context.registerHighlighter({
        createSession: () => ({ refresh: () => pending, applyChange: () => pending, dispose() {} }),
      }),
  }
  const restored = mount([createScopeLinesPlugin(), highlighter])
  restored.editor.openDocument({ text: source, documentId: 'file-a', languageId: 'typescript' })
  await expect
    .poll(() => restored.host.querySelectorAll('.editor-scope-line').length)
    .toBeGreaterThan(0)
  const root = restored.host.querySelector<HTMLElement>('.editor-scope-lines')!
  expect(getComputedStyle(root).visibility).toBe('visible')
  restored.editor.setSnapshot(capture.paint, 'file-a')
  expect(restored.editor.getPresentationState()).toBe('provisional')
  expect(getComputedStyle(root).visibility).toBe('hidden')
  expect(restored.host.querySelectorAll('[data-editor-saved-paint-layer]').length).toBeGreaterThan(
    0,
  )

  resolve({ tokens: EditorTokenStore.empty() })
  await expect.poll(() => restored.editor.getPresentationState()).toBe('live')
  expect(getComputedStyle(root).visibility).toBe('visible')
  expect(restored.host.querySelectorAll('[data-editor-saved-paint-layer]')).toHaveLength(0)
  expect(root.childElementCount).toBeGreaterThan(0)
})

function mount(plugins: readonly EditorPlugin[], snapshot: string | null = null) {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:120px'
  document.body.append(host)
  elements.push(host)
  const editor = new Editor(host, {
    lineHeight: 20,
    tabSize: 2,
    plugins,
    documentKey: 'file-a',
    snapshot,
  })
  editors.push(editor)
  return { editor, host }
}
