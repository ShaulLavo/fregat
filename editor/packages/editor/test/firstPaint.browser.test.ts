import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/public/document'
import type { EditorInitialPaintEvent } from '../src/plugins'
import { createError } from '../src/logging/evlog'
import {
  createTreeSitterSyntaxPlugin,
  createTreeSitterSyntaxProvider,
  resolveTreeSitterLanguageContribution,
  TreeSitterWorkerClient,
  type TreeSitterBackend,
} from '../../tree-sitter/src/index'
import { TYPESCRIPT_TREE_SITTER_LANGUAGE } from '../../tree-sitter-languages/src/index'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofRowScreenshot: (hostId: string) => Promise<string>
  }
}

const editors: Editor[] = []
const hosts: HTMLElement[] = []
const workers: TreeSitterWorkerClient[] = []
const releases: (() => void)[] = []
let nextHostId = 0

afterEach(async () => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const release of releases.splice(0)) release()
  for (const worker of workers.splice(0)) await worker.dispose()
  for (const host of hosts.splice(0)) host.remove()
})

function delayedGrammar() {
  let release = (_success: boolean) => {}
  const boundary = new Promise<boolean>((resolve) => {
    release = resolve
  })
  releases.push(() => release(true))
  const worker = new TreeSitterWorkerClient()
  workers.push(worker)
  const disposedSessions: string[] = []
  const parsedSessions: string[] = []
  let loadStarted = false
  const backend = {
    registerLanguages: (languages) => worker.registerLanguages(languages),
    parse: (payload) => {
      parsedSessions.push(payload.runtimeSessionId)
      return worker.parse(payload)
    },
    edit: (payload) => worker.edit(payload),
    queryRange: (payload) => worker.queryRange(payload),
    select: (payload) => worker.select(payload),
    disposeDocument: (runtimeSessionId) => {
      disposedSessions.push(runtimeSessionId)
      worker.disposeDocument(runtimeSessionId)
    },
  } satisfies TreeSitterBackend
  const provider = createTreeSitterSyntaxProvider({ backend })
  provider.registerLanguage({
    id: 'typescript',
    load: async () => {
      loadStarted = true
      const success = await boundary
      if (success) return resolveTreeSitterLanguageContribution(TYPESCRIPT_TREE_SITTER_LANGUAGE)
      throw createError({
        message: 'Grammar asset unavailable',
        code: 'TEST_GRAMMAR_UNAVAILABLE',
        status: 503,
        why: 'The external language asset failed to load.',
        fix: 'Release the test language boundary successfully.',
      })
    },
  })
  return {
    plugin: createTreeSitterSyntaxPlugin(provider),
    worker,
    disposedSessions,
    parsedSessions,
    loadStarted: () => loadStarted,
    release: () => release(true),
    fail: () => release(false),
  }
}

function open(grammar: ReturnType<typeof delayedGrammar>, text = 'const answer = 4;') {
  const host = document.createElement('div')
  host.id = `first-paint-${nextHostId++}`
  host.style.cssText = 'width:600px;height:120px;display:flex'
  document.body.append(host)
  hosts.push(host)
  const paints: EditorInitialPaintEvent[] = []
  const editor = new Editor(host, {
    lineHeight: 20,
    plugins: [grammar.plugin],
    cursorLineHighlight: { rowBackground: false },
    onInitialPaint: (event) => paints.push(event),
  })
  editors.push(editor)
  const buffer = createEditorTextBuffer(text)
  editor.attachSession(createEditorBufferSession(buffer), {
    documentId: 'shared.ts',
    languageId: 'typescript',
  })
  return { editor, host, buffer, paints }
}

async function visibleBeforeReady(
  view: ReturnType<typeof open>,
  grammar: ReturnType<typeof delayedGrammar>,
) {
  await expect.poll(grammar.loadStarted).toBe(true)
  await expect
    .poll(() => view.host.querySelector('[data-editor-virtual-row="0"]')?.textContent)
    .toBe(view.buffer.materializeFullText())
  const pixels = await rowPixels(view.host)
  expect(pixels.ink).toBeGreaterThan(20)
  expect(pixels.chromatic).toBe(0)
  expect(view.editor.getState().initialHighlightStatus).toBe('loading')
  expect(view.paints.some((event) => event.phase === 'text')).toBe(true)
  expect(view.paints.some((event) => event.phase === 'highlight-settled')).toBe(false)
}

async function highlighted(view: ReturnType<typeof open>, token: string) {
  await expect.poll(() => view.editor.getState().initialHighlightStatus).toBe('painted')
  expect(view.editor.getState().syntaxStatus).toBe('ready')
  await expect.poll(() => highlightedText(view.host)).toContain(token)
  const pixels = await rowPixels(view.host)
  expect(pixels.ink).toBeGreaterThan(20)
  expect(pixels.chromatic).toBeGreaterThan(20)
  return pixels
}

function highlightedText(host: HTMLElement): string[] {
  const text: string[] = []
  for (const highlight of CSS.highlights.values()) {
    for (const range of highlight) {
      if (!host.contains(range.startContainer)) continue
      const readable = document.createRange()
      readable.setStart(range.startContainer, range.startOffset)
      readable.setEnd(range.endContainer, range.endOffset)
      text.push(readable.toString())
    }
  }
  return text
}

async function rowPixels(host: HTMLElement) {
  const image = await commands.proofRowScreenshot(host.id)
  const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  expect(context).not.toBeNull()
  if (!context) return { ink: 0, chromatic: 0, red: 0 }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let ink = 0
  let chromatic = 0
  let red = 0
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]!
    const g = data[index + 1]!
    const b = data[index + 2]!
    const distance = Math.abs(r - data[0]!) + Math.abs(g - data[1]!) + Math.abs(b - data[2]!)
    if (distance > 70) ink++
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) chromatic++
    if (r > g + 80 && r > b + 80) red++
  }
  return { ink, chromatic, red }
}

test('paints usable text and accepts trusted typing while the real grammar is delayed', async () => {
  const grammar = delayedGrammar()
  const view = open(grammar)
  await visibleBeforeReady(view, grammar)
  const initialRevision = view.buffer.getRevision()
  const initialPaint = view.paints.find((event) => event.phase === 'text')
  const trustedKeys: boolean[] = []
  view.editor
    .getInputElement()
    .addEventListener('keydown', (event) => trustedKeys.push(event.isTrusted))
  const offset = view.buffer.materializeFullText().indexOf('4') + 1
  view.editor.setSelection(offset, offset)
  view.editor.focus()
  await commands.proofKeyPress('2')
  expect(trustedKeys).toEqual([true])
  expect(view.buffer.materializeFullText()).toBe('const answer = 42;')
  expect(view.buffer.getRevision()).toBe(initialRevision + 1)
  await visibleBeforeReady(view, grammar)

  grammar.release()
  await highlighted(view, '42')
  expect(view.editor.materializeFullText()).toBe('const answer = 42;')
  const settled = view.paints.find((event) => event.phase === 'highlight-settled')
  expect(settled).toMatchObject({ documentId: 'shared.ts', status: 'painted' })
  expect(settled?.textVersion).toBeGreaterThan(initialPaint?.textVersion ?? -1)
  expect(view.paints.filter((event) => event.phase === 'text')).toHaveLength(1)
})

test('ends a failed grammar load in an observable terminal state with text still painted', async () => {
  const grammar = delayedGrammar()
  const view = open(grammar)
  await visibleBeforeReady(view, grammar)
  grammar.fail()

  await expect.poll(() => view.editor.getState().initialHighlightStatus).toBe('error')
  expect(view.editor.getState().syntaxStatus).toBe('error')
  expect(view.paints).toContainEqual(
    expect.objectContaining({
      phase: 'highlight-settled',
      documentId: 'shared.ts',
      status: 'error',
    }),
  )
  expect((await rowPixels(view.host)).ink).toBeGreaterThan(20)
  expect(grammar.parsedSessions).toEqual([])
})

test('disposes a waiting session without parsing it and preserves the simultaneous editor', async () => {
  const grammar = delayedGrammar()
  const first = open(grammar, 'const first = 1;')
  const second = open(grammar, 'const second = 222;')
  await visibleBeforeReady(first, grammar)
  await visibleBeforeReady(second, grammar)
  first.editor.dispose()
  const disposed = [...grammar.disposedSessions]
  const paints = [...first.paints]
  expect(disposed.length).toBeGreaterThan(0)
  grammar.release()

  await highlighted(second, '222')
  await grammar.worker.awaitIdleFence()
  expect(grammar.parsedSessions.every((session) => !disposed.includes(session))).toBe(true)
  expect(first.paints).toEqual(paints)
  expect(grammar.worker.inspect().cache.sourceChunks.documents).toBe(1)
  expect(second.editor.materializeFullText()).toBe('const second = 222;')
  second.editor.dispose()
  await grammar.worker.awaitIdleFence()
  expect(grammar.worker.inspect().cache.sourceChunks.sentChunks).toBe(0)
  expect(grammar.worker.inspect().pendingRequests).toBe(0)
  await grammar.worker.dispose()
  expect(grammar.worker.inspect().cache.sourceChunks.documents).toBe(0)
  expect(grammar.worker.inspect().lifecycle).toBe('disposed')
})

test('adopts only the replacement document and current theme after delayed readiness', async () => {
  const grammar = delayedGrammar()
  const view = open(grammar, 'const old = 7;')
  await visibleBeforeReady(view, grammar)
  const replacement = createEditorTextBuffer('const replacement = 987;')
  view.editor.attachSession(createEditorBufferSession(replacement), {
    documentId: 'replacement.ts',
    languageId: 'typescript',
  })
  view.editor.setTheme({
    backgroundColor: '#ffffff',
    foregroundColor: '#222222',
    syntax: { number: '#ff0000' },
  })
  grammar.release()

  const pixels = await highlighted(view, '987')
  expect(pixels.red).toBeGreaterThan(20)
  expect(highlightedText(view.host)).not.toContain('7')
  expect(view.editor.materializeFullText()).toBe('const replacement = 987;')
  const settled = view.paints.filter((event) => event.phase === 'highlight-settled')
  expect(settled).toEqual([
    expect.objectContaining({
      documentId: 'replacement.ts',
      status: 'painted',
    }),
  ])
  await grammar.worker.awaitIdleFence()
  expect(grammar.worker.inspect().cache.sourceChunks.documents).toBe(1)
})
