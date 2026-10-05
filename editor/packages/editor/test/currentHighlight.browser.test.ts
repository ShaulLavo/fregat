import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor, createEditorDocumentAnalysis, createEditorPreparedDocument } from '../src/editor'
import { createEditorTextBuffer, createEditorBufferSession } from '../src/public/document'
import { createShikiHighlighterProvider, createShikiWorkerOwner } from '../src/shiki/index'
import { createTreeSitterSyntaxProvider, TreeSitterWorkerClient } from '../../tree-sitter/src/index'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import type { EditorInitialPaintEvent } from '../src/plugins'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofViewportScreenshot: (hostId: string) => Promise<string>
  }
}

test('keeps current input and rebased paint pending until the native highlight reply is accepted', async () => {
  const language = await import('@shikijs/langs/typescript')
  const theme = await import('@shikijs/themes/dark-plus')
  const gate = heldNativeShikiReplies()
  const worker = createShikiWorkerOwner({ workerFactory: gate.createWorker })
  const referenceWorker = createShikiWorkerOwner()
  const options = {
    languages: { typescript: 'typescript' },
    theme: 'dark-plus',
    resolveLanguage: async () => language.default,
    resolveTheme: async () => ({ ...theme.default, name: 'dark-plus' }),
  }
  const provider = createShikiHighlighterProvider({ ...options, workerOwner: worker })
  const referenceProvider = createShikiHighlighterProvider({
    ...options,
    workerOwner: referenceWorker,
  })
  const tree = new TreeSitterWorkerClient()
  const structural = createTreeSitterSyntaxProvider({ backend: tree })
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
    structural.registerLanguage(contribution)
  const source = "export const editorTabA = 'real browser fixture A'\n"
  const prefix = '// held identity response\n'
  const buffer = createEditorTextBuffer(source)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'held-current.ts' })
  const prepared = createEditorPreparedDocument({
    analysis,
    buffer,
    documentId: 'held-current.ts',
    languageId: 'typescript',
    configuredTabSize: 4,
    tabSizePolicy: 'detect-indentation',
    documentConfigurationTag: ['current-ready198'],
  })
  const host = document.createElement('div')
  host.id = 'current-highlight-proof'
  host.style.cssText =
    'display:flex;height:240px;width:600px;min-height:0;min-width:0;overflow:hidden'
  document.body.append(host)
  const paints: EditorInitialPaintEvent[] = []
  let editor: Editor | null = null
  try {
    expect(
      await prepared.startStage({
        family: 'structural',
        provider: structural,
        configuration: { includeCaptures: false, includeHighlights: false, syntaxMode: 'range' },
        configurationTag: ['current-ready198'],
        range: { startIndex: 0, endIndex: source.length },
        abortSignal: new AbortController().signal,
      }),
    ).toBe('ready')
    expect(
      await prepared.startStage({
        family: 'highlighter',
        provider,
        themeProviders: [provider],
        configurationTag: ['current-ready198'],
        range: 'full',
        abortSignal: new AbortController().signal,
      }),
    ).toBe('ready')
    const beforeAttach = gate.requests.length
    editor = new Editor(host, {
      onInitialPaint: (event) => paints.push(event),
      plugins: [
        {
          activate: (context) => [
            context.registerSyntaxProvider(structural),
            context.registerHighlighter(provider),
          ],
        },
      ],
    })
    editor.attachSession(createEditorBufferSession(buffer), {
      analysis,
      preparedDocument: prepared,
      documentId: 'held-current.ts',
      languageId: 'typescript',
      documentConfigurationTag: ['current-ready198'],
      structuralConfigurationTag: ['current-ready198'],
      highlighterConfigurationTag: ['current-ready198'],
    })
    expect(editor.getState()).toMatchObject({
      syntaxStatus: 'ready',
      initialHighlightStatus: 'painted',
    })
    expect(editor.captureSnapshot()).not.toBeNull()
    expect(gate.requests).toHaveLength(beforeAttach)
    expect(paints.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    const settledPaints = paints.length
    gate.arm()
    editor.edit({ from: 0, to: 0, text: prefix })
    expect(buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length)).toBe(prefix + source)
    await expect.poll(() => gate.held.length).toBe(1)
    await expect.poll(() => editor!.getState().syntaxStatus).toBe('ready')
    const referenceBuffer = createEditorTextBuffer(prefix + source)
    const reference = referenceProvider.createSession({
      documentId: 'independent-current.ts',
      languageId: 'typescript',
      textSnapshot: referenceBuffer.getTextSnapshot(),
      snapshot: referenceBuffer.getSnapshot(),
    })
    expect(reference).not.toBeNull()
    const exact = await reference!.refresh(referenceBuffer.getTextSnapshot())
    expect(
      exact.tokens.toTokens().some((token) => token.start === 0 && token.style.color === '#6A9955'),
    ).toBe(true)
    const rebased = editor['syntax'].tokens.toTokens()
    expect(rebased.length).toBeGreaterThan(0)
    expect(rebased.every((token) => token.start >= prefix.length)).toBe(true)
    expect(
      analysis.inspectRetention().entries.find((entry) => entry.family === 'highlighter'),
    ).toMatchObject({ revision: 1, status: 'pending' })
    console.log(
      '[current-ready198-held]',
      JSON.stringify({
        state: editor.getState(),
        source: buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length),
        retained: analysis.inspectRetention(),
        rebased,
        exact: exact.tokens.toTokens(),
        captured: editor.captureSnapshot() !== null,
        requests: gate.requests,
        held: gate.held.map((event) => event.data),
        screenshot: await commands.proofViewportScreenshot(host.id),
      }),
    )
    expect(editor.getState()).toMatchObject({
      syntaxStatus: 'ready',
      initialHighlightStatus: 'loading',
    })
    expect(editor.captureSnapshot()).toBeNull()
    expect(editor['syntax'].copyTokens.length).toBe(0)
    editor.edit({ from: 0, to: 0, text: 'x' })
    expect(buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length)).toBe(
      'x' + prefix + source,
    )
    gate.releaseFirst()
    await expect.poll(() => gate.held.length).toBe(1)
    await expect.poll(() => editor!.getState().syntaxStatus).toBe('ready')
    expect(
      analysis.inspectRetention().entries.find((entry) => entry.family === 'highlighter'),
    ).toMatchObject({ revision: 2, status: 'pending' })
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(editor.captureSnapshot()).toBeNull()
    gate.releaseAll()
    await expect.poll(() => editor!.getState().initialHighlightStatus).toBe('painted')
    const finalBuffer = createEditorTextBuffer('x' + prefix + source)
    const finalReference = await reference!.refresh(finalBuffer.getTextSnapshot())
    expect(editor['syntax'].tokens.toTokens()).toEqual(finalReference.tokens.toTokens())
    expect(editor.captureSnapshot()).not.toBeNull()
    expect(paints).toHaveLength(settledPaints)
    console.log(
      '[current-ready198-current]',
      JSON.stringify({
        state: editor.getState(),
        source: buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length),
        retained: analysis.inspectRetention(),
        actual: editor['syntax'].tokens.toTokens(),
        exact: finalReference.tokens.toTokens(),
        requests: gate.requests,
        screenshot: await commands.proofViewportScreenshot(host.id),
      }),
    )
    reference!.dispose()
  } finally {
    gate.releaseAll()
    editor?.dispose()
    prepared.dispose()
    analysis.dispose()
    host.remove()
    await worker.dispose()
    await referenceWorker.dispose()
    tree.dispose()
  }
}, 15_000)

function heldNativeShikiReplies() {
  const requests: unknown[] = []
  const edits: number[] = []
  const held: MessageEvent<unknown>[] = []
  let armed = false
  let deliver: ((event: MessageEvent<unknown>) => void) | null = null
  const releaseFirst = () => {
    const event = held.shift()
    if (event) deliver?.(event)
  }
  return {
    requests,
    held,
    releaseFirst,
    arm: () => {
      armed = true
    },
    releaseAll: () => {
      armed = false
      while (held.length) releaseFirst()
    },
    createWorker: () => {
      const worker = new Worker(new URL('../src/shiki/shiki.worker.ts', import.meta.url), {
        type: 'module',
      })
      const post = worker.postMessage.bind(worker)
      worker.postMessage = (...args: Parameters<Worker['postMessage']>) => {
        const value: unknown = args[0]
        requests.push(value)
        const id = nativeEditId(value)
        if (id !== null) edits.push(id)
        Reflect.apply(post, worker, args)
      }
      const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')
      if (!descriptor?.set) throw new TypeError('Native worker message descriptor unavailable')
      Object.defineProperty(worker, 'onmessage', {
        configurable: true,
        set: (listener: Worker['onmessage']) => {
          deliver = (event) => listener?.call(worker, event)
          descriptor.set?.call(worker, (event: MessageEvent<unknown>) => {
            if (armed && edits.includes(nativeMessageId(event.data) ?? -1)) {
              held.push(event)
              return
            }
            deliver?.(event)
          })
        },
      })
      return worker
    },
  }
}

function nativeMessageId(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  return typeof value.id === 'number' ? value.id : null
}

function nativeEditId(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('payload' in value)) return null
  const payload = value.payload
  if (!payload || typeof payload !== 'object' || !('type' in payload) || payload.type !== 'edit')
    return null
  return nativeMessageId(value)
}
