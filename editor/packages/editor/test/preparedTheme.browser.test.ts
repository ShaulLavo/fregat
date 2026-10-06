import { expect, test } from 'vitest'
import {
  Editor,
  createEditorDocumentAnalysis,
  createEditorPreparedDocument,
} from '@singapore-editor/core/editor'
import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import {
  createShikiHighlighterProvider,
  createShikiWorkerOwner,
} from '@singapore-editor/core/shiki'
import {
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerOwner,
} from '../../tree-sitter/dist/index.js'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/dist/index.js'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'
import type { EditorInitialPaintEvent } from '../src/plugins'
import type { EditorPerformanceDiagnostic } from '../src/editor/performanceDiagnostics'
import '@singapore-editor/core/style.css'

test.each(['typescript', 'markdown'] as const)(
  'attaches public Shiki %s preparation with synchronous theme, paint and capture',
  async (language) => {
    const languageModule =
      language === 'typescript'
        ? await import('@shikijs/langs/typescript')
        : await import('@shikijs/langs/markdown')
    const themeModule = await import('@shikijs/themes/github-dark')
    const shiki = createShikiWorkerOwner()
    const tree = createTreeSitterWorkerOwner()
    const structural = createTreeSitterSyntaxProvider({ workerOwner: tree })
    for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
      structural.registerLanguage(contribution)
    const original = createShikiHighlighterProvider({
      workerOwner: shiki,
      languages: { [language]: language },
      theme: 'github-dark',
      resolveLanguage: async () => languageModule.default,
      resolveTheme: async () => ({ ...themeModule.default, name: 'github-dark' }),
    })
    let loads = 0
    const loadTheme = original.loadTheme
    if (!loadTheme) throw new TypeError('Public Shiki theme loader unavailable')
    const provider: EditorHighlighterProvider = {
      ...original,
      loadTheme: () => {
        loads++
        return loadTheme.call(original)
      },
    }
    const line =
      language === 'typescript'
        ? 'export const retained = { answer: 42 };\n'
        : '# Retained document\n\n**bold** and `code`\n\n'
    const source = line.repeat(Math.ceil(4096 / line.length)).slice(0, 4096)
    const buffer = createEditorTextBuffer(source)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'prepared' })
    const prepared = createEditorPreparedDocument({
      analysis,
      buffer,
      documentId: 'prepared',
      languageId: language,
      configuredTabSize: 4,
      tabSizePolicy: 'detect-indentation',
      documentConfigurationTag: ['ready'],
    })
    const container = document.createElement('div')
    container.style.cssText =
      'display:flex;height:240px;width:600px;min-height:0;min-width:0;overflow:hidden'
    document.body.appendChild(container)
    let editor: Editor | null = null
    const requests: unknown[] = []
    const post = Worker.prototype.postMessage
    const previousDiagnostics: unknown = Reflect.get(
      globalThis,
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
    )
    const reads: EditorPerformanceDiagnostic[] = []
    Reflect.set(
      globalThis,
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
      (sample: EditorPerformanceDiagnostic) => {
        if (typeof previousDiagnostics === 'function') previousDiagnostics(sample)
        if (sample.name === 'textSnapshot.read') reads.push(sample)
      },
    )
    try {
      expect(
        await prepared.startStage({
          family: 'structural',
          provider: structural,
          configuration: { includeCaptures: false, includeHighlights: false, syntaxMode: 'range' },
          configurationTag: ['ready'],
          range: { startIndex: 0, endIndex: source.length },
          abortSignal: new AbortController().signal,
        }),
      ).toBe('ready')
      expect(
        await prepared.startStage({
          family: 'highlighter',
          provider,
          themeProviders: [provider],
          configurationTag: ['ready'],
          range: 'full',
          abortSignal: new AbortController().signal,
        }),
      ).toBe('ready')
      const ids = prepared.runtimeSessionIds()
      expect(loads).toBe(1)
      buffer.getTextSnapshot().readRange(0, source.length)
      expect(reads.some((read) => read.detail?.fullTextReads === 1)).toBe(true)
      reads.length = 0
      const events: EditorInitialPaintEvent[] = []
      Worker.prototype.postMessage = function (...args) {
        requests.push(args[0])
        return Reflect.apply(post, this, args)
      }
      editor = new Editor(container, {
        onInitialPaint: (event) => events.push(event),
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
        documentId: 'prepared',
        languageId: language,
        documentConfigurationTag: ['ready'],
        structuralConfigurationTag: ['ready'],
        highlighterConfigurationTag: ['ready'],
      })
      expect(editor.getState()).toMatchObject({
        syntaxStatus: 'ready',
        initialHighlightStatus: 'painted',
      })
      expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
      expect(editor.captureSnapshot()).not.toBeNull()
      expect(requests).toEqual([])
      expect(reads.some((read) => read.detail?.fullTextReads === 1)).toBe(false)
      expect(
        analysis
          .inspectRetention()
          .entries.map((entry) => entry.runtimeSessionId)
          .sort(),
      ).toEqual([...ids.structural, ...ids.highlighter].sort())
      await Promise.resolve()
      await Promise.resolve()
      expect(loads).toBe(1)
      expect(requests).toEqual([])
      expect(reads.some((read) => read.detail?.fullTextReads === 1)).toBe(false)
      Worker.prototype.postMessage = post
      const pendingBuffer = createEditorTextBuffer(source)
      const pendingAnalysis = createEditorDocumentAnalysis({
        buffer: pendingBuffer,
        documentId: 'pending-theme',
      })
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let pendingLoads = 0
      const pendingProvider: EditorHighlighterProvider = {
        ...original,
        loadTheme: async () => {
          const first = ++pendingLoads === 1
          const theme = await loadTheme.call(original)
          if (first) await held
          return theme
        },
      }
      const pendingRequest = {
        provider: pendingProvider,
        languageId: language,
        configurationTag: ['pending'],
      }
      const pendingLease = pendingAnalysis.borrowHighlighter(pendingRequest)!
      const obsolete = pendingLease.refresh(pendingBuffer.getTextSnapshot()).then(
        () => 'ready',
        () => 'rejected',
      )
      const edits: Promise<string>[] = []
      const pendingHost = document.createElement('div')
      pendingHost.style.cssText = 'display:flex;height:240px;width:600px'
      document.body.appendChild(pendingHost)
      let pendingEditor: Editor | null = null
      try {
        await expect.poll(() => pendingLoads).toBe(1)
        pendingEditor = new Editor(pendingHost, {
          plugins: [{ activate: (context) => context.registerHighlighter(pendingProvider) }],
        })
        pendingEditor.attachSession(createEditorBufferSession(pendingBuffer), {
          analysis: pendingAnalysis,
          documentId: 'pending-theme',
          languageId: language,
          highlighterConfigurationTag: ['pending'],
        })
        for (let edit = 0; edit < 3; edit++) {
          pendingEditor.edit({ from: 0, to: 0, text: '!' })
          expect(pendingEditor.materializeFullText()).toBe('!'.repeat(edit + 1) + source)
          expect(pendingEditor.getState().initialHighlightStatus).toBe('loading')
          expect(pendingEditor.captureSnapshot()).toBeNull()
          edits.push(
            pendingLease.refresh(pendingBuffer.getTextSnapshot()).then(
              () => 'ready',
              () => 'rejected',
            ),
          )
        }
        const warm = pendingAnalysis.borrowHighlighter(pendingRequest)!
        expect(warm.runtimeSessionId).toBe(pendingLease.runtimeSessionId)
        expect(warm.read().kind).toBe('pending')
        const current = warm.refresh(pendingBuffer.getTextSnapshot())
        release()
        await current
        expect(await obsolete).toBe('rejected')
        expect(warm.read()).toMatchObject({ kind: 'ready', revision: pendingBuffer.getRevision() })
        expect(pendingLoads).toBe(1)
        await expect.poll(() => pendingEditor?.getState().initialHighlightStatus).toBe('painted')
        expect(pendingEditor.materializeFullText()).toBe('!!!' + source)
        warm.dispose()
      } finally {
        release()
        pendingEditor?.dispose()
        pendingHost.remove()
        pendingLease.dispose()
        pendingAnalysis.dispose()
        await Promise.all(edits)
      }
    } finally {
      Worker.prototype.postMessage = post
      Reflect.set(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__', previousDiagnostics)
      editor?.dispose()
      prepared.dispose()
      analysis.dispose()
      container.remove()
      await Promise.all([tree.dispose(), shiki.dispose()])
    }
  },
)
