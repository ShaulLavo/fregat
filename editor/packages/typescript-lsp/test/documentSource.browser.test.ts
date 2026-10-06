import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { Editor } from '@singapore-editor/core'
import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import type { LspWorkerLike } from '@singapore-editor/lsp'
import type { LanguageServerConnectionContext } from '@singapore-editor/lsp-plugin'
import { createTypeScriptLspPlugin } from '../src'
import '@singapore-editor/core/style.css'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

function fixture() {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:200px'
  document.body.append(host)
  const state: {
    context: LanguageServerConnectionContext | null
    terminated: number
    sent: Record<string, unknown>[]
    errors: unknown[]
    ready: number
  } = { context: null, terminated: 0, sent: [], errors: [], ready: 0 }
  const plugin = createTypeScriptLspPlugin({
    diagnosticDelayMs: 0,
    documentSync: {
      uriForDocument: () => 'file:///main.ts',
      shouldSyncUri: () => true,
      shouldSyncLanguageId: () => true,
      languageIdForDocument: () => 'typescript',
    },
    onConnectionCreated(context) {
      state.context = context
    },
    onStatusChange(status) {
      if (status === 'ready') state.ready++
    },
    onError(error) {
      state.errors.push(error)
    },
    workerFactory: () => {
      const worker = new Worker(new URL('../src/typescriptLsp.worker.ts', import.meta.url), {
        type: 'module',
      })
      const handle: LspWorkerLike = {
        postMessage(message) {
          if (isRecord(message)) state.sent.push(message)
          worker.postMessage(message)
        },
        addEventListener: (type, handler) => worker.addEventListener(type, handler),
        removeEventListener: (type, handler) => worker.removeEventListener(type, handler),
        terminate: () => {
          state.terminated++
          worker.terminate()
        },
      }
      return handle
    },
  })
  const editor = new Editor(host, { plugins: [plugin] })
  cleanup.push(() => {
    editor.dispose()
    host.remove()
  })
  const context = () => {
    if (!state.context) expect.unreachable('Real connection required')
    return state.context
  }
  const symbols = () =>
    context().client.request<readonly { name: string }[]>('textDocument/documentSymbol', {
      textDocument: { uri: 'file:///main.ts' },
    })
  return { host, editor, state, context, symbols }
}

test('plain Editor setText reaches the real TypeScript worker and replacement retires source', async () => {
  const { editor, host, state, context, symbols } = fixture()
  editor.setText('export const first = 1', { languageId: 'typescript' })
  await expect
    .poll(() => ({ ready: state.ready, errors: state.errors }), { timeout: 10000 })
    .toEqual({ ready: 1, errors: [] })
  expect((await symbols()).map((symbol) => symbol.name)).toContain('first')
  const initial = context().workspace.getDocument('file:///main.ts')!
  expect(initial.textSnapshot.readRange(0, initial.textSnapshot.length)).toBe(
    editor.materializeFullText(),
  )
  await expect
    .poll(() => host.querySelector('[data-editor-virtual-row="0"]')?.textContent)
    .toContain('first')
  await page.screenshot({ element: host, path: '../.vitest/evidence/typescript-plain-initial.png' })
  editor.setText('export const second = 2', { languageId: 'typescript' })
  expect((await symbols()).map((symbol) => symbol.name)).toContain('second')
  await expect
    .poll(() => host.querySelector('[data-editor-virtual-row="0"]')?.textContent)
    .toContain('second')
  await page.screenshot({
    element: host,
    path: '../.vitest/evidence/typescript-plain-replaced.png',
  })
  expect(context().workspace.getDocument('file:///main.ts')?.sourceSegment).not.toBe(
    initial.sourceSegment,
  )
  editor.clear()
  await expect.poll(() => context().workspace.getDocument('file:///main.ts')).toBeNull()
  await expect
    .poll(() => host.querySelector('[data-editor-virtual-row="0"]')?.textContent ?? '')
    .toBe('')
  await page.screenshot({ element: host, path: '../.vitest/evidence/typescript-clear.png' })
  editor.dispose()
  expect(state.terminated).toBe(1)
  expect(state.errors).toEqual([])
}, 15000)

test('shared buffer edits, undo and save synchronize once before real worker queries', async () => {
  const { editor, state, context, symbols } = fixture()
  const buffer = createEditorTextBuffer('export const alpha = 1')
  const session = createEditorBufferSession(buffer)
  editor.attachSession(session, { languageId: 'typescript' })
  await expect
    .poll(() => ({ ready: state.ready, errors: state.errors }), { timeout: 10000 })
    .toEqual({ ready: 1, errors: [] })
  expect((await symbols()).map((symbol) => symbol.name)).toContain('alpha')
  session.applyEdits([{ from: 13, to: 18, text: 'omega' }])
  expect((await symbols()).map((symbol) => symbol.name)).toContain('omega')
  const change = state.sent.filter((frame) => frame.method === 'textDocument/didChange')
  expect(change).toHaveLength(1)
  expect(context().workspace.getDocument('file:///main.ts')?.version).toBe(1)
  buffer.undo()
  expect((await symbols()).map((symbol) => symbol.name)).toContain('alpha')
  await context().workspace.saveDocument('file:///main.ts')
  editor.dispose()
  const count = state.sent.length
  session.applyText('!')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(state.sent).toHaveLength(count)
  expect(state.terminated).toBe(1)
  expect(state.errors).toEqual([])
}, 15000)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
