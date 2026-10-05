import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor, createEditorDocumentAnalysis, createEditorPreparedDocument } from '../src/editor'
import { createEditorTextBuffer, createEditorBufferSession } from '../src/public/document'
import { createShikiHighlighterProvider, createShikiWorkerOwner } from '../src/shiki/index'
import { createTreeSitterSyntaxProvider, TreeSitterWorkerClient } from '../../tree-sitter/src/index'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import type { EditorInitialPaintEvent } from '../src/plugins'
import type {
  EditorSyntaxProvider,
  EditorSyntaxResult,
  EditorSyntaxSession,
} from '../src/syntax/session'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofViewportScreenshot: (hostId: string) => Promise<string>
  }
}

test.for([false, true])(
  'keeps native current highlighting pending with structural replacement=%s',
  { timeout: 15_000 },
  async (overlap, { annotate }) => {
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
    const replacement = holdNativeStructuralProvider(structural)
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
      if (!overlap) {
        expect(
          await prepared.startStage({
            family: 'structural',
            provider: structural,
            configuration: {
              includeCaptures: false,
              includeHighlights: false,
              syntaxMode: 'range',
            },
            configurationTag: ['current-ready198'],
            range: { startIndex: 0, endIndex: source.length },
            abortSignal: new AbortController().signal,
          }),
        ).toBe('ready')
      }
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
              ...(!overlap ? [context.registerSyntaxProvider(structural)] : []),
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
        syntaxStatus: overlap ? 'plain' : 'ready',
        initialHighlightStatus: 'painted',
      })
      expect(editor.captureSnapshot()).not.toBeNull()
      expect(gate.requests).toHaveLength(beforeAttach)
      expect(paints.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
      const settledPaints = paints.length
      if (overlap) {
        editor.addPlugin({
          activate: (context) => context.registerSyntaxProvider(replacement.provider),
        })
        await expect.poll(() => replacement.produced.length).toBeGreaterThan(0)
        expect(editor.getState().initialHighlightStatus).toBe('loading')
        await annotate(
          JSON.stringify({
            state: editor.getState(),
            revision: buffer.getRevision(),
            replacement: capturedReplacement(editor),
            produced: replacement.produced,
            tree: tree.inspect(),
            highlighter: worker.inspect(),
          }),
          'current-ready198-replacement-held',
        )
      }
      gate.arm()
      editor.edit({ from: 0, to: 0, text: prefix })
      expect(buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length)).toBe(
        prefix + source,
      )
      await expect.poll(() => gate.held.length).toBe(1)
      if (overlap) {
        await annotate(
          JSON.stringify({
            state: editor.getState(),
            revision: buffer.getRevision(),
            replacement: capturedReplacement(editor),
            produced: replacement.produced,
            tree: tree.inspect(),
            highlighter: worker.inspect(),
            held: gate.held.map((event) => event.data),
          }),
          'current-ready198-content-before-structure-release',
        )
        replacement.release()
      }
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
        exact.tokens
          .toTokens()
          .some((token) => token.start === 0 && token.style.color === '#6A9955'),
      ).toBe(true)
      const rebased = editor['syntax'].tokens.toTokens()
      expect(rebased.length).toBeGreaterThan(0)
      expect(rebased.every((token) => token.start >= prefix.length)).toBe(true)
      expect(
        analysis.inspectRetention().entries.find((entry) => entry.family === 'highlighter'),
      ).toMatchObject({ revision: 1, status: 'pending' })
      await annotate(
        JSON.stringify({
          state: editor.getState(),
          source: buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length),
          retained: analysis.inspectRetention(),
          revision: buffer.getRevision(),
          worker: worker.inspect(),
          copy: editor['syntax'].copyTokens.toTokens(),
          rebased,
          exact: exact.tokens.toTokens(),
          captured: editor.captureSnapshot() !== null,
          requests: gate.requests,
          held: gate.held.map((event) => event.data),
          screenshot: await commands.proofViewportScreenshot(host.id),
        }),
        'current-ready198-held',
      )
      expect(editor.getState()).toMatchObject({
        syntaxStatus: 'ready',
        initialHighlightStatus: 'loading',
      })
      expect(editor.captureSnapshot()).toBeNull()
      expect(editor['syntax'].copyTokens.length).toBe(0)
      editor.setTheme({ backgroundColor: '#161616' })
      await annotate(
        JSON.stringify({
          state: editor.getState(),
          source: buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length),
          captured: editor.captureSnapshot() !== null,
          retained: analysis.inspectRetention(),
        }),
        'current-ready198-appearance',
      )
      expect(editor.getState().initialHighlightStatus).toBe('loading')
      expect(editor.captureSnapshot()).toBeNull()
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
      expect(editor['syntax'].copyTokens.toTokens()).toEqual(finalReference.tokens.toTokens())
      expect(editor.captureSnapshot()).not.toBeNull()
      expect(paints).toHaveLength(settledPaints + Number(overlap))
      await annotate(
        JSON.stringify({
          state: editor.getState(),
          source: buffer.getTextSnapshot().readRange(0, buffer.getSnapshot().length),
          retained: analysis.inspectRetention(),
          revision: buffer.getRevision(),
          worker: worker.inspect(),
          copy: editor['syntax'].copyTokens.toTokens(),
          captured: editor.captureSnapshot() !== null,
          actual: editor['syntax'].tokens.toTokens(),
          exact: finalReference.tokens.toTokens(),
          requests: gate.requests,
          screenshot: await commands.proofViewportScreenshot(host.id),
        }),
        'current-ready198-current',
      )
      reference!.dispose()
    } finally {
      replacement.release()
      gate.releaseAll()
      editor?.dispose()
      prepared.dispose()
      analysis.dispose()
      host.remove()
      await worker.dispose()
      await referenceWorker.dispose()
      await tree.dispose()
    }
  },
)

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
      const post = worker.postMessage
      worker.postMessage = (
        value: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ) => {
        requests.push(value)
        const id = nativeEditId(value)
        if (id !== null) edits.push(id)
        Reflect.apply(post, worker, [value, transferOrOptions])
      }
      const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')
      if (!descriptor?.set) expect.fail('Native worker message descriptor unavailable')
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

function holdNativeStructuralProvider(provider: EditorSyntaxProvider) {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const produced: EditorSyntaxResult[] = []
  const hold = async (result: Promise<EditorSyntaxResult>) => {
    const value = await result
    produced.push(value)
    await released
    return value
  }
  return {
    produced,
    release,
    provider: {
      createSession: (options) => {
        const session = provider.createSession(options)
        if (!session) return null
        const query = session.queryRange?.bind(session)
        const gated: EditorSyntaxSession = {
          get foldingSupport() {
            return session.foldingSupport
          },
          refresh: (snapshot) => hold(session.refresh(snapshot)),
          applyChange: (change) => hold(session.applyChange(change)),
          canQueryRange: () => session.canQueryRange?.() ?? Boolean(query),
          queryRange: query ? (range) => hold(query(range)) : undefined,
          getResult: () => session.getResult(),
          getTokens: () => session.getTokens(),
          getSnapshotVersion: () => session.getSnapshotVersion(),
          dispose: () => session.dispose(),
        }
        return gated
      },
    } satisfies EditorSyntaxProvider,
  }
}

function capturedReplacement(editor: Editor): unknown {
  return Reflect.get(editor['syntax'], 'pendingInitialHighlightReplacement')
}
