import { afterEach, expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import typescript from '@shikijs/langs/typescript'
import darkPlus from '@shikijs/themes/dark-plus'
import { Editor } from '../src/editor/Editor'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/public/document'
import { createShikiHighlighterProvider } from '../src/shiki/plugin'
import { createShikiWorkerOwner } from '../src/shiki/workerClient'
import type { ShikiWorkerRequest } from '../src/shiki/workerTypes'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'
import '../src/style.css'

const editors: Editor[] = []
const hosts: HTMLElement[] = []
const cleanups: (() => void | Promise<void>)[] = []

afterEach(async () => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const cleanup of cleanups.splice(0)) await cleanup()
  for (const host of hosts.splice(0)) host.remove()
})

const largeText = Array.from(
  { length: 80 },
  (_, index) => `export const value${index} = ${index}\n`,
).join('')

function shiki() {
  const sessions: string[] = []
  const owner = createShikiWorkerOwner({
    workerFactory: () => {
      const worker = new Worker(new URL('../src/shiki/shiki.worker.ts', import.meta.url), {
        type: 'module',
      })
      const post = worker.postMessage.bind(worker)
      vi.spyOn(worker, 'postMessage').mockImplementation((request: ShikiWorkerRequest) => {
        if (request.payload.type === 'open' && !sessions.includes(request.payload.runtimeSessionId))
          sessions.push(request.payload.runtimeSessionId)
        post(request)
      })
      return worker
    },
  })
  const shikiProvider = createShikiHighlighterProvider({
    workerOwner: owner,
    theme: 'dark-plus',
    resolveLanguage: async () => typescript,
    resolveTheme: async () => ({ ...darkPlus, name: 'dark-plus' }),
  })
  const provider = shikiProvider
  cleanups.push(() => owner.dispose())
  return { owner, provider, sessions }
}

function mount(provider: EditorHighlighterProvider) {
  const host = document.createElement('div')
  host.style.cssText = 'width:600px;height:200px;display:flex'
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor(host, {
    lineHeight: 20,
    plugins: [{ activate: (context) => context.registerHighlighter(provider) }],
  })
  editors.push(editor)
  return { editor, host }
}

function paint(host: HTMLElement) {
  const runs: { row: number; from: number; to: number; text: string; style: string }[] = []
  for (const [name, highlight] of CSS.highlights) {
    if (!name.startsWith('editor-shared-token-')) continue
    for (const range of highlight) append(range, name)
  }
  return runs.toSorted((left, right) => left.row - right.row || left.from - right.from)

  function append(range: AbstractRange, style: string) {
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return
    const row = range.startContainer.parentElement?.closest<HTMLElement>(
      '[data-editor-virtual-row]',
    )
    if (!row) throw new TypeError('Painted source row unavailable')
    const prefix = document.createRange()
    prefix.selectNodeContents(row)
    prefix.setEnd(range.startContainer, range.startOffset)
    const text = document.createRange()
    text.setStart(range.startContainer, range.startOffset)
    text.setEnd(range.endContainer, range.endOffset)
    const from = prefix.toString().length
    runs.push({
      row: Number(row.dataset.editorVirtualRow),
      from,
      to: from + text.toString().length,
      text: text.toString(),
      style,
    })
  }
}

async function frame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function sourceRows(host: HTMLElement) {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]'), (row) => ({
    row: Number(row.dataset.editorVirtualRow),
    text: row.textContent,
  })).toSorted((left, right) => left.row - right.row)
}

function retained(text: string) {
  const { owner, provider, sessions } = shiki()
  const buffer = createEditorTextBuffer(text)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'shared.ts' })
  cleanups.unshift(() => analysis.dispose())
  const options = { analysis, documentId: 'shared.ts', languageId: 'typescript' } as const
  const lease = analysis.borrowHighlighter({ provider, languageId: 'typescript' })
  if (!lease) throw new TypeError('Real Shiki lease unavailable')
  cleanups.unshift(() => lease.dispose())
  const attach = (scrollPosition?: ReturnType<Editor['getScrollPosition']>) => {
    const view = mount(provider)
    view.editor.attachSession(createEditorBufferSession(buffer), { ...options, scrollPosition })
    return view
  }
  return { owner, provider, sessions, buffer, lease, attach }
}

test('calibrates complete large shared Shiki paint in two views', async () => {
  const shared = retained(largeText)
  await shared.lease.refresh(shared.buffer.getTextSnapshot())
  const first = shared.attach()
  const second = shared.attach(first.editor.getScrollPosition())
  await frame()
  const reference = paint(first.host)
  expect(reference.length).toBeGreaterThan(60)
  expect(new Set(reference.map((run) => run.row)).size).toBeGreaterThanOrEqual(10)
  expect(paint(second.host)).toEqual(reference)
  expect(shared.sessions).toEqual([shared.lease.runtimeSessionId])
  expect(shared.owner.inspect().workerGeneration).toBe(1)
})

test.each(['buffer', 'input'] as const)(
  'paints ready shared Shiki %s edits before copying a split',
  async (origin) => {
    const initial = 'export const before = 1\n'
    const shared = retained(initial)
    await shared.lease.refresh(shared.buffer.getTextSnapshot())
    const first = shared.attach()
    await frame()
    await shared.owner.awaitIdleFence()
    const session = createEditorBufferSession(shared.buffer)
    if (origin === 'buffer') {
      session.setSelection(initial.length, initial.length)
      session.applyText(largeText)
    } else {
      first.editor.setSelection(initial.length)
      first.editor.focus()
      await commands.proofInsertText(largeText)
    }
    await shared.owner.awaitIdleFence()
    await shared.lease.refresh(shared.buffer.getTextSnapshot())
    expect(shared.lease.read()).toMatchObject({ kind: 'ready', revision: 1 })
    const second = shared.attach(first.editor.getScrollPosition())
    expect(sourceRows(first.host)).toEqual(sourceRows(second.host))
    const reference = paint(second.host)
    expect(reference.length).toBeGreaterThan(60)
    expect(paint(first.host)).toEqual(reference)
    expect(shared.sessions).toEqual([shared.lease.runtimeSessionId])
    expect(shared.buffer.materializeFullText()).toBe(initial + largeText)
    expect(session.isDirty()).toBe(true)
    const firstSelection = first.editor.getSelections()
    second.editor.setSelection(initial.length + 5)
    expect(first.editor.getSelections()).toEqual(firstSelection)
    second.editor.dispose()
    expect(paint(first.host)).toEqual(reference)
    first.editor.dispatchCommand('undo')
    await shared.owner.awaitIdleFence()
    await shared.lease.refresh(shared.buffer.getTextSnapshot())
    expect(shared.buffer.materializeFullText()).toBe(initial)
    expect(session.isDirty()).toBe(false)
    expect(
      paint(first.host)
        .map((run) => run.text)
        .join(''),
    ).toContain('before')
  },
)

test('paints real Shiki tokens with plain Editor setup', async () => {
  const { owner, provider } = shiki()
  const view = mount(provider)
  view.editor.setText(largeText, { languageId: 'typescript' })
  await owner.awaitIdleFence()
  await expect.poll(() => paint(view.host).length).toBeGreaterThan(60)
  expect(view.editor.materializeFullText()).toBe(largeText)
})
