import { waitForDocumentWork } from '../src/editor/documentWork'
import type { EditorHighlighterOperationContext } from '../src/document/operations'
import {
  createEditorStructuralOperation,
  createEditorHighlighterOperation,
} from '../src/editor/operationDefinitions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Editor } from '../src/editor/Editor'
import type {
  EditorInitialPaintEvent,
  EditorLogEvent,
  EditorPlugin,
  EditorInitialHighlightStatus,
  EditorViewContributionUpdateKind,
} from '../src/plugins'
import type { EditorHighlightResult, EditorHighlighterRuntime } from '../src/syntax/highlighter'
import { createEditorLoggingPlugin } from '../src/logging'
import type { EditorTheme } from '../src/theme'
import {
  createEmptySyntaxResult,
  EditorTokenStore,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
  styleForTreeSitterCapture,
  treeSitterCapturesToEditorTokens,
} from '../src/public/syntax'

const TEXT = 'const value = 1'

it('marks current highlighter work pending on the direct provider path while keeping rebased tokens', async () => {
  const initial = deferred<EditorHighlightResult>()
  const update = deferred<EditorHighlightResult>()
  const structure = deferred<EditorSyntaxResult>()
  const events: EditorInitialPaintEvent[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, {
    plugins: [
      highlighterPlugin({
        analyze: (read, signal) =>
          waitForDocumentWork(
            read.revision.point.revision === 0 ? initial.promise : update.promise,
            signal,
          ),
        dispose: () => undefined,
      }),
      syntaxPlugin(syntaxSession(structure)),
    ],
    onInitialPaint: (event) => events.push(event),
  })
  try {
    editor.openDocument({ documentId: 'current.ts', languageId: 'typescript', text: TEXT })
    initial.resolve({ tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: RED }]) })
    structure.resolve(createEmptySyntaxResult())
    await vi.waitFor(() =>
      expect(editor.getState()).toMatchObject({
        syntaxStatus: 'ready',
        initialHighlightStatus: 'painted',
      }),
    )
    expect(editor.getState()).toMatchObject({
      syntaxStatus: 'ready',
      initialHighlightStatus: 'painted',
    })
    const settled = events.length
    const prefix = '// pending\n'
    editor.edit({ from: 0, to: 0, text: prefix })
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    await vi.waitFor(() => expect(editor.getState().syntaxStatus).toBe('ready'))
    expect(editor.getState()).toMatchObject({
      syntaxStatus: 'ready',
      initialHighlightStatus: 'loading',
    })
    expect(editor['syntax'].tokens.toTokens()).toEqual([
      { start: prefix.length, end: prefix.length + 5, style: RED },
    ])
    expect(editor['syntax'].renderDataReady).toBe(false)
    expect(editor['syntax'].copyTokens.length).toBe(0)
    const current = EditorTokenStore.fromTokens([
      { start: 0, end: prefix.length - 1, style: { color: '#008000' } },
      { start: prefix.length, end: prefix.length + 5, style: RED },
    ])
    update.resolve({ tokens: current })
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('painted')
    expect(editor['syntax'].tokens.toTokens()).toEqual(current.toTokens())
    expect(editor['syntax'].renderDataReady).toBe(true)
    expect(events).toHaveLength(settled)
  } finally {
    update.resolve({ tokens: EditorTokenStore.empty() })
    editor.dispose()
    container.remove()
  }
})

it.each(['ready', 'error'] as const)(
  'keeps the current edit pending when a prior structural replacement becomes %s',
  async (outcome) => {
    const update = deferred<EditorHighlightResult>()
    const structure = deferred<EditorSyntaxResult>()
    const initialTokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: RED }])
    let refreshes = 0
    const events: EditorInitialPaintEvent[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const editor = new Editor(host, {
      plugins: [
        highlighterPlugin({
          analyze: (_read, signal) =>
            waitForDocumentWork(
              ++refreshes === 1 ? Promise.resolve({ tokens: initialTokens }) : update.promise,
              signal,
            ),
          dispose: () => undefined,
        }),
      ],
      onInitialPaint: (event) => events.push(event),
    })
    try {
      editor.openDocument({ documentId: 'overlap.ts', languageId: 'typescript', text: TEXT })
      await expect.poll(() => editor.getState().initialHighlightStatus).toBe('painted')
      editor.addPlugin(syntaxPlugin(syntaxSession(structure)))
      expect(editor.getState().initialHighlightStatus).toBe('loading')
      editor.edit({ from: 0, to: 0, text: '// pending\n' })
      expect(editor.materializeFullText()).toBe('// pending\n' + TEXT)
      expect(editor.getState().initialHighlightStatus).toBe('loading')
      if (outcome === 'ready') structure.resolve(createEmptySyntaxResult())
      if (outcome === 'error') structure.reject(new TypeError('Held structural provider failed'))
      await expect.poll(() => editor.getState().syntaxStatus).toBe(outcome)
      expect(editor.getState().initialHighlightStatus).toBe('loading')
      expect(editor['syntax'].renderDataReady).toBe(false)
      expect(editor['syntax'].copyTokens.length).toBe(0)
      expect(editor['syntax'].tokens.toTokens()).toEqual([{ start: 11, end: 16, style: RED }])
      expect(events.filter(isHighlightSettled)).toHaveLength(1)
      const current = EditorTokenStore.fromTokens([
        { start: 0, end: 10, style: { color: '#008000' } },
        { start: 11, end: 16, style: RED },
      ])
      update.resolve({ tokens: current })
      await expect.poll(() => editor.getState().initialHighlightStatus).toBe('painted')
      expect(editor['syntax'].tokens.toTokens()).toEqual(current.toTokens())
      expect(editor['syntax'].copyTokens.toTokens()).toEqual(current.toTokens())
      expect(editor['syntax'].renderDataReady).toBe(true)
      expect(events.filter(isHighlightSettled)).toHaveLength(2)
    } finally {
      structure.resolve(createEmptySyntaxResult())
      update.resolve({ tokens: EditorTokenStore.empty() })
      editor.dispose()
      host.remove()
    }
  },
)

it('keeps a current edit pending when a theme terminal captured before the edit settles', async () => {
  const update = deferred<EditorHighlightResult>()
  const theme = deferred<EditorTheme>()
  const initialTokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: RED }])
  const events: EditorInitialPaintEvent[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, {
    plugins: [
      highlighterPlugin(
        {
          analyze: (read, signal) =>
            waitForDocumentWork(
              read.revision.point.revision === 0
                ? Promise.resolve({ tokens: initialTokens })
                : update.promise,
              signal,
            ),
          dispose: () => undefined,
        },
        () => theme.promise,
      ),
    ],
    onInitialPaint: (event) => events.push(event),
  })
  try {
    editor.openDocument({ documentId: 'theme-overlap.ts', languageId: 'typescript', text: TEXT })
    await expect.poll(() => editor['syntax'].tokens.length).toBe(1)
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(events.filter(isHighlightSettled)).toHaveLength(0)
    editor.edit({ from: 0, to: 0, text: '// pending\n' })
    const appearance = { foregroundColor: '#222222' }
    theme.resolve(appearance)
    await expect.poll(() => editor['syntax'].providerTheme).toEqual(appearance)
    expect(editor.materializeFullText()).toBe('// pending\n' + TEXT)
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(editor['syntax'].renderDataReady).toBe(false)
    expect(editor['syntax'].copyTokens.length).toBe(0)
    expect(editor['syntax'].tokens.toTokens()).toEqual([{ start: 11, end: 16, style: RED }])
    expect(events.filter(isHighlightSettled)).toHaveLength(0)
    const current = EditorTokenStore.fromTokens([
      { start: 0, end: 10, style: { color: '#008000' } },
      { start: 11, end: 16, style: RED },
    ])
    update.resolve({ tokens: current })
    await expect.poll(() => editor.getState().initialHighlightStatus).toBe('painted')
    expect(editor['syntax'].copyTokens.toTokens()).toEqual(current.toTokens())
    expect(events.filter(isHighlightSettled)).toHaveLength(1)
  } finally {
    theme.resolve({})
    update.resolve({ tokens: EditorTokenStore.empty() })
    editor.dispose()
    host.remove()
  }
})

describe('syntax capture conversion', () => {
  it('maps known capture names to editor token styles', () => {
    expect(styleForTreeSitterCapture('keyword.declaration')).toEqual({
      color: 'var(--editor-syntax-keyword-declaration)',
    })
    expect(styleForTreeSitterCapture('string')).toEqual({
      color: 'var(--editor-syntax-string)',
    })
    expect(styleForTreeSitterCapture('constructor')).toEqual({
      color: 'var(--editor-syntax-type-definition)',
    })
    expect(styleForTreeSitterCapture('text.title')).toEqual({
      color: 'var(--editor-syntax-keyword-declaration)',
      fontWeight: 700,
    })
    expect(styleForTreeSitterCapture('text.uri')).toEqual({
      color: 'var(--editor-syntax-string)',
      textDecoration: 'underline',
    })
    expect(styleForTreeSitterCapture('unknown.scope')).toBeNull()
  })

  it('converts non-empty captures to editor tokens', () => {
    const tokens = treeSitterCapturesToEditorTokens([
      { startIndex: 0, endIndex: 5, captureName: 'keyword.declaration' },
      { startIndex: 6, endIndex: 6, captureName: 'string' },
      { startIndex: 7, endIndex: 10, captureName: 'not.mapped' },
    ])

    expect(tokens).toEqual([
      {
        start: 0,
        end: 5,
        style: { color: 'var(--editor-syntax-keyword-declaration)' },
      },
    ])
  })
})

describe('authoritative initial paint', () => {
  it('publishes the terminal plain snapshot before its once-per-generation events', () => {
    const order: string[] = []
    const events: EditorInitialPaintEvent[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [snapshotOrderPlugin(order)],
      onInitialPaint: (event) => {
        events.push(event)
        order.push(`event:${event.phase}`)
      },
    })

    editor.openDocument({ documentId: 'plain.ts', text: 'const value = 1' })

    expect(editor.getState().initialHighlightStatus).toBe('plain')
    expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    expect(order.indexOf('snapshot:document:plain')).toBeLessThan(order.indexOf('event:text'))
    expect(order.indexOf('snapshot:document:plain')).toBeLessThan(
      order.indexOf('event:highlight-settled'),
    )

    editor.openDocument({ documentId: 'plain.ts', text: 'const value = 1' })
    const textEvents = events.filter((event) => event.phase === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0]?.documentGeneration).not.toBe(textEvents[1]?.documentGeneration)

    editor.dispose()
    container.remove()
  })

  it('waits for highlighter adoption and publishes the terminal snapshot before the event', async () => {
    const result = deferred<EditorHighlightResult>()
    const events: EditorInitialPaintEvent[] = []
    const order: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const session: EditorHighlighterRuntime = {
      analyze: async (read, signal) => {
        result.markStarted()
        const value = await waitForDocumentWork(result.promise, signal)
        const offset = Math.max(0, read.text.readRange(0, read.text.length).indexOf(TEXT))
        return {
          ...value,
          tokens: EditorTokenStore.fromTokens(
            value.tokens
              .toTokens()
              .map((token) => ({ ...token, start: token.start + offset, end: token.end + offset })),
          ),
        }
      },
      dispose: () => undefined,
    }
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(session), snapshotOrderPlugin(order)],
      onInitialPaint: (event) => {
        events.push(event)
        order.push(`event:${event.phase}`)
      },
    })

    editor.openDocument({ documentId: 'highlight.ts', languageId: 'typescript', text: TEXT })
    await nextTask()

    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(events.map((event) => event.phase)).toEqual(['text'])

    result.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }]),
    })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.map((event) => event.phase)).toEqual(['text', 'highlight-settled'])
    const terminalSnapshot = order.lastIndexOf('snapshot:tokens:painted')
    expect(terminalSnapshot).toBeGreaterThan(-1)
    expect(terminalSnapshot).toBeLessThan(order.indexOf('event:highlight-settled'))

    editor.dispose()
    container.remove()
  })

  it('re-emits the authoritative paint after an asynchronous provider replacement', async () => {
    const result = deferred<EditorHighlightResult>()
    const events: EditorInitialPaintEvent[] = []
    const order: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [snapshotOrderPlugin(order)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'replace.ts', text: TEXT })
    expect(events).toHaveLength(2)

    editor.addPlugin(
      highlighterPlugin({
        analyze: (_read, signal) => {
          result.markStarted()
          return waitForDocumentWork(result.promise, signal)
        },
        dispose: () => undefined,
      }),
    )
    await nextTask()

    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(order).toContain('snapshot:tokens:loading')

    result.resolve({ tokens: EditorTokenStore.empty() })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isHighlightSettled).map((event) => event.status)).toEqual([
      'plain',
      'painted',
    ])

    editor.dispose()
    container.remove()
  })

  it.each(['structure-first', 'Shiki-first'] as const)(
    'uses the highlighter as the authoritative result when %s',
    async (order) => {
      const structure = deferred<EditorSyntaxResult>()
      const highlight = deferred<EditorHighlightResult>()
      const events: EditorInitialPaintEvent[] = []
      const snapshots: EditorInitialHighlightStatus[] = []
      const container = document.createElement('div')
      document.body.appendChild(container)
      const editor = new Editor(container, {
        plugins: [
          syntaxPlugin(syntaxSession(structure)),
          highlighterPlugin(highlighterSession(highlight)),
          statusSnapshotPlugin(snapshots),
        ],
        onInitialPaint: (event) => events.push(event),
      })

      editor.openDocument({ documentId: 'race.ts', languageId: 'typescript', text: TEXT })
      await nextTask()

      if (order === 'structure-first') {
        structure.resolve(createEmptySyntaxResult())
        await nextTask()
        expect(editor.getState().initialHighlightStatus).toBe('loading')
        expect(events.filter(isHighlightSettled)).toHaveLength(0)
        highlight.resolve({ tokens: EditorTokenStore.empty() })
      } else {
        highlight.resolve({ tokens: EditorTokenStore.empty() })
        await nextTask()
        expect(editor.getState().initialHighlightStatus).toBe('painted')
        expect(events.filter(isHighlightSettled)).toHaveLength(1)
        structure.resolve(createEmptySyntaxResult())
      }
      await nextTask()

      expect(editor.getState().initialHighlightStatus).toBe('painted')
      expect(events.filter(isHighlightSettled)).toHaveLength(1)
      expect(snapshots.at(-1)).toBe('painted')

      editor.dispose()
      container.remove()
    },
  )

  it('publishes degraded and error as terminal structural outcomes', async () => {
    const degraded = deferred<EditorSyntaxResult>()
    const degradedEvents: EditorInitialPaintEvent[] = []
    const degradedEditor = createSyntaxEditor(degraded, degradedEvents)

    degraded.resolve(
      createEmptySyntaxResult({
        degraded: { kind: 'optional-phase-failed', phase: 'highlights', message: 'unavailable' },
      }),
    )
    await nextTask()

    expect(degradedEditor.editor.getState().initialHighlightStatus).toBe('degraded')
    expect(degradedEvents.filter(isHighlightSettled)).toEqual([
      expect.objectContaining({ status: 'degraded' }),
    ])
    degradedEditor.dispose()

    const failed = deferred<EditorSyntaxResult>()
    const failedEvents: EditorInitialPaintEvent[] = []
    const failedEditor = createSyntaxEditor(failed, failedEvents)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await failed.started
    failed.reject(new Error('parse failed'))
    await nextTask()

    expect(failedEditor.editor.getState().initialHighlightStatus).toBe('error')
    expect(failedEvents.filter(isHighlightSettled)).toEqual([
      expect.objectContaining({ status: 'error' }),
    ])
    warn.mockRestore()
    failedEditor.dispose()
  })

  it('keeps a valid highlighter edit result across structural recovery in the same configuration', async () => {
    const editedHighlight = deferred<EditorHighlightResult>()
    const snapshots: Array<{
      readonly foregroundColor: string | null
      readonly status: EditorInitialHighlightStatus
      readonly tokens: readonly [number, number][]
    }> = []
    let syntaxSessionCount = 0
    const structuralPlugin: EditorPlugin = {
      activate: (context) =>
        context.registerSyntaxProvider({
          operation: createEditorStructuralOperation(() => {
            syntaxSessionCount += 1
            const failEdits = syntaxSessionCount === 1
            return {
              analyze: (read) =>
                read.revision.point.revision === 0
                  ? (async () => createEmptySyntaxResult())()
                  : (async () => {
                      if (failEdits) throw new Error('edit parse failed')
                      return createEmptySyntaxResult()
                    })(),
              getResult: () => createEmptySyntaxResult(),
              getTokens: () => [],
              foldingSupport: 'supported',
              getSnapshotVersion: () => 0,
              dispose: () => undefined,
            }
          }),
        }),
    }
    const highlighter: EditorHighlighterRuntime = {
      analyze: (read) =>
        read.revision.point.revision === 0
          ? (async () => ({
              tokens: EditorTokenStore.fromTokens([
                { start: 0, end: 5, style: { color: '#ff0000' } },
              ]),
            }))()
          : (() => editedHighlight.promise)(),
      dispose: () => undefined,
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [structuralPlugin, highlighterPlugin(highlighter), themeSnapshotPlugin(snapshots)],
    })
    editor.openDocument({ documentId: 'edit-recovery.ts', languageId: 'typescript', text: TEXT })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))

    editor.edit({ from: 0, to: 0, text: 'x' })
    await new Promise((resolve) => setTimeout(resolve, 90))
    expect(syntaxSessionCount).toBeGreaterThan(1)

    editedHighlight.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 1, end: 6, style: { color: '#00ff00' } }]),
    })
    await nextTask()
    expect(snapshots.at(-1)?.tokens).toEqual([[1, 6]])

    editor.dispose()
    warn.mockRestore()
    container.remove()
  })

  it('rejects a stale result from the previous same-id document generation', async () => {
    const first = deferred<EditorHighlightResult>()
    const second = deferred<EditorHighlightResult>()
    const sessions = [highlighterSession(first), highlighterSession(second)]
    const events: EditorInitialPaintEvent[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [
        {
          activate: (context) =>
            context.registerHighlighter({
              operation: createEditorHighlighterOperation(() => sessions.shift() ?? null),
            }),
        },
      ],
      onInitialPaint: (event) => events.push(event),
    })

    editor.openDocument({ documentId: 'same.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    editor.openDocument({ documentId: 'same.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    first.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'stale' } }]),
    })
    await nextTask()

    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(events.filter(isHighlightSettled)).toHaveLength(0)

    second.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: 'fresh' } }]),
    })
    await nextTask()

    const terminal = events.filter(isHighlightSettled)
    expect(terminal).toHaveLength(1)
    expect(terminal[0]?.documentGeneration).toBe(events.filter(isTextPaint)[1]?.documentGeneration)
    editor.dispose()
    container.remove()
  })

  it('keeps provider replacement authoritative across a lower-priority theme update', async () => {
    const replacement = deferred<EditorHighlightResult>()
    const events: EditorInitialPaintEvent[] = []
    const snapshots: EditorInitialHighlightStatus[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [statusSnapshotPlugin(snapshots)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'overlap.ts', text: TEXT })
    const [textPaint] = events.filter(isTextPaint)
    if (!textPaint) throw new Error('initial text paint missing')
    expect(events.filter(isTextPaint)).toHaveLength(1)
    expect(events.filter(isHighlightSettled).map((event) => event.status)).toEqual(['plain'])

    editor.addPlugin(highlighterPlugin(highlighterSession(replacement)))
    await nextTask()
    const loadingSnapshot = snapshots.lastIndexOf('loading')
    editor.setTheme({ foregroundColor: '#abcdef' })
    editor.edit({ from: 0, to: 0, text: 'x' })
    await new Promise((resolve) => setTimeout(resolve, 375))

    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(snapshots.slice(loadingSnapshot + 1)).not.toContain('plain')
    expect(snapshots.slice(loadingSnapshot + 1)).not.toContain('painted')
    expect(events.filter(isTextPaint)).toHaveLength(1)
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    replacement.resolve({ tokens: EditorTokenStore.empty() })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isTextPaint)).toHaveLength(1)
    const settled = events.filter(isHighlightSettled)
    expect(settled.map((event) => event.status)).toEqual(['plain', 'painted'])
    expect(settled[1]?.documentGeneration).toBe(textPaint.documentGeneration)
    expect(settled[1]?.textVersion).toBe(textPaint.textVersion + 1)

    editor.dispose()
    container.remove()
  })

  it('waits to publish a terminal provider replacement until its deferred theme is adopted', async () => {
    const highlight = deferred<EditorHighlightResult>()
    const editedHighlight = deferred<EditorHighlightResult>()
    const logs: EditorLogEvent[] = []
    const theme = deferred<EditorTheme | null | undefined>()
    const events: EditorInitialPaintEvent[] = []
    const snapshots: Array<{
      readonly foregroundColor: string | null
      readonly status: EditorInitialHighlightStatus
      readonly tokens: readonly [number, number][]
    }> = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [
        themeSnapshotPlugin(snapshots),
        createEditorLoggingPlugin((event) => logs.push(event)),
      ],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'provider-theme.ts', languageId: 'typescript', text: TEXT })
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    editor.addPlugin(
      highlighterPlugin(
        {
          analyze: (read, signal) =>
            waitForDocumentWork(
              read.revision.point.revision === 0 ? highlight.promise : editedHighlight.promise,
              signal,
            ),
          dispose: () => {},
        },
        () => theme.promise,
      ),
    )
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('loading')

    highlight.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }]),
    })
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    editor.setTheme({ backgroundColor: '#abcdef' })
    editor.edit({ from: 0, to: 0, text: 'x' })
    editor.setTokens([{ start: 1, end: 6, style: { color: '#00ff00' } }])
    const currentTokens = EditorTokenStore.fromTokens([
      { start: 1, end: 6, style: { color: '#00ff00' } },
    ])
    editedHighlight.resolve({ tokens: currentTokens })
    await expect
      .poll(() => logs.filter((event) => event.action === 'editor.syntax.highlight_applied').length)
      .toBe(2)
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(editor['syntax'].copyTokens.toTokens()).toEqual(currentTokens.toTokens())
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    theme.resolve({ foregroundColor: '#123456' })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(snapshots.at(-1)).toEqual({
      foregroundColor: '#123456',
      status: 'painted',
      tokens: [[1, 6]],
    })
    expect(events.filter(isHighlightSettled).map((event) => event.status)).toEqual([
      'plain',
      'painted',
    ])

    editedHighlight.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 1, end: 6, style: { color: '#00ff00' } }]),
    })
    await nextTask()
    expect(snapshots.at(-1)?.tokens).toEqual([[1, 6]])
    editor.dispose()
    container.remove()
  })

  it('rejects a removed provider theme that resolves after its request is cancelled', async () => {
    const highlight = deferred<EditorHighlightResult>()
    const theme = deferred<EditorTheme | null | undefined>()
    const snapshots: Array<{
      readonly foregroundColor: string | null
      readonly status: EditorInitialHighlightStatus
      readonly tokens: readonly [number, number][]
    }> = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, { plugins: [themeSnapshotPlugin(snapshots)] })
    editor.openDocument({ documentId: 'removed-theme.ts', languageId: 'typescript', text: TEXT })

    const registration = editor.addPlugin(
      highlighterPlugin(highlighterSession(highlight), () => theme.promise),
    )
    await nextTask()
    highlight.resolve({ tokens: EditorTokenStore.empty() })
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('loading')

    registration.dispose()
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('plain')
    expect(snapshots.at(-1)?.foregroundColor).toBeNull()

    theme.resolve({ foregroundColor: '#abcdef' })
    await nextTask()
    expect(editor.getState().initialHighlightStatus).toBe('plain')
    expect(snapshots.at(-1)?.foregroundColor).toBeNull()

    editor.dispose()
    container.remove()
  })

  it('keeps an initial applicable result live across a theme update', async () => {
    const initial = deferred<EditorHighlightResult>()
    const events: EditorInitialPaintEvent[] = []
    const snapshots: Array<{
      readonly foregroundColor: string | null
      readonly status: EditorInitialHighlightStatus
      readonly tokens: readonly [number, number][]
    }> = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighterSession(initial)), themeSnapshotPlugin(snapshots)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'initial-theme.ts', languageId: 'typescript', text: TEXT })
    await nextTask()

    editor.setTheme({ foregroundColor: '#abcdef' })
    expect(editor.getState().initialHighlightStatus).toBe('loading')
    expect(snapshots.at(-1)?.foregroundColor).toBe('#abcdef')
    initial.resolve({ tokens: EditorTokenStore.empty() })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    editor.dispose()
    container.remove()
  })

  it('refreshes theme and syntax snapshots and re-emits after provider replacement', async () => {
    const initial = deferred<EditorHighlightResult>()
    const syntax = deferred<EditorSyntaxResult>()
    const events: EditorInitialPaintEvent[] = []
    const snapshots: EditorInitialHighlightStatus[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighterSession(initial)), statusSnapshotPlugin(snapshots)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'config.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    initial.resolve({ tokens: EditorTokenStore.empty() })
    await nextTask()
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    editor.setTheme({ backgroundColor: '#101010' })
    expect(snapshots.slice(-2)).toEqual(['loading', 'painted'])
    expect(events.filter(isHighlightSettled)).toHaveLength(1)

    editor.addPlugin(syntaxPlugin(syntaxSession(syntax)))
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isHighlightSettled)).toHaveLength(2)
    syntax.resolve(createEmptySyntaxResult())
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isHighlightSettled)).toHaveLength(2)

    editor.dispose()
    container.remove()
  })

  it('settles a non-applicable syntax replacement from existing highlighter paint', async () => {
    const initial = deferred<EditorHighlightResult>()
    const events: EditorInitialPaintEvent[] = []
    const snapshots: EditorInitialHighlightStatus[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighterSession(initial)), statusSnapshotPlugin(snapshots)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({ documentId: 'non-applicable.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    initial.resolve({ tokens: EditorTokenStore.empty() })
    await nextTask()

    editor.addPlugin({
      activate: (context) =>
        context.registerSyntaxProvider({
          operation: createEditorStructuralOperation(() => null),
        }),
    })

    expect(editor.getState().initialHighlightStatus).toBe('painted')
    expect(snapshots.slice(-2)).toEqual(['loading', 'painted'])
    expect(events.filter(isHighlightSettled)).toHaveLength(2)

    editor.dispose()
    container.remove()
  })

  it('preserves an existing highlighter error across a non-applicable syntax replacement', async () => {
    const initial = deferred<EditorHighlightResult>()
    const snapshots: EditorInitialHighlightStatus[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighterSession(initial)), statusSnapshotPlugin(snapshots)],
    })
    editor.openDocument({ documentId: 'error.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    initial.reject(new Error('highlight failed'))
    // The rejection settles only once the retry ladder runs out.
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('error'), {
      timeout: 3_000,
    })

    editor.addPlugin({
      activate: (context) =>
        context.registerSyntaxProvider({
          operation: createEditorStructuralOperation(() => null),
        }),
    })

    expect(editor.getState().initialHighlightStatus).toBe('error')
    expect(snapshots.slice(-2)).toEqual(['loading', 'error'])

    editor.dispose()
    warn.mockRestore()
    container.remove()
  })

  it('keeps highlighter paint authoritative when a structural replacement fails', async () => {
    const replacementHighlight = deferred<EditorHighlightResult>()
    const structure = deferred<EditorSyntaxResult>()
    const events: EditorInitialPaintEvent[] = []
    let refreshCount = 0
    const highlighter: EditorHighlighterRuntime = {
      analyze: (read) =>
        read.revision.point.revision === 0
          ? (() => {
              refreshCount += 1
              if (refreshCount === 1) return Promise.resolve({ tokens: EditorTokenStore.empty() })
              return replacementHighlight.promise
            })()
          : (() => replacementHighlight.promise)(),
      dispose: () => undefined,
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighter)],
      onInitialPaint: (event) => events.push(event),
    })
    editor.openDocument({
      documentId: 'structural-failure.ts',
      languageId: 'typescript',
      text: TEXT,
    })
    await nextTask()

    editor.addPlugin(syntaxPlugin(syntaxSession(structure)))
    await nextTask()
    structure.reject(new Error('structural parse failed'))
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))
    expect(events.filter(isHighlightSettled).map((event) => event.status)).toEqual([
      'painted',
      'painted',
    ])

    replacementHighlight.resolve({ tokens: EditorTokenStore.empty() })
    await vi.waitFor(() => expect(editor.getState().initialHighlightStatus).toBe('painted'))

    editor.dispose()
    warn.mockRestore()
    container.remove()
  })

  it('keeps useful highlighter tokens when a structural provider is added', async () => {
    const refresh = vi.fn(async () => ({
      tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: RED }]),
    }))
    const snapshots: Parameters<typeof themeSnapshotPlugin>[0] = []
    const highlighter: EditorHighlighterRuntime = {
      analyze: refresh,
      dispose: () => undefined,
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const editor = new Editor(container, {
      plugins: [highlighterPlugin(highlighter), themeSnapshotPlugin(snapshots)],
    })
    editor.openDocument({ documentId: 'provider-refresh.ts', languageId: 'typescript', text: TEXT })
    await nextTask()
    expect(refresh).toHaveBeenCalledTimes(1)

    editor.addPlugin(syntaxPlugin(syntaxSession(deferred<EditorSyntaxResult>())))
    await nextTask()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(editor.getState().initialHighlightStatus).toBe('painted')
    expect(snapshots.at(-1)?.tokens).toEqual([[0, 5]])

    editor.dispose()
    container.remove()
  })
})

describe('highlight refresh retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a failed refresh and paints when a later attempt succeeds', async () => {
    let refreshes = 0
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (async () => {
              refreshes += 1
              if (refreshes === 1) throw new Error('worker restarted')
              return { tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: RED }]) }
            })()
          : (async () => ({ tokens: EditorTokenStore.empty() }))(),
      dispose: () => undefined,
    }))

    await vi.advanceTimersByTimeAsync(0)
    expect(refreshes).toBe(1)
    expect(view.editor.getState().initialHighlightStatus).toBe('loading')

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    expect(refreshes).toBe(2)
    expect(view.editor.getState().initialHighlightStatus).toBe('painted')
    expect(view.snapshots.at(-1)?.tokens).toEqual([[0, 5]])
    expect(view.actions('editor.syntax.highlight_request_failed')).toHaveLength(1)
    expect(view.actions('editor.syntax.highlight_retries_exhausted')).toHaveLength(0)
    const recovered = view.actions('editor.syntax.highlight_recovered')
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ level: 'info', syntax: { attempts: 2 } })
    expect(view.paints.filter(isHighlightSettled).map((event) => event.status)).toEqual(['painted'])
    view.dispose()
  })

  it('gives up after a bounded number of attempts with one terminal event', async () => {
    let refreshes = 0
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (async () => {
              refreshes += 1
              throw new Error(`grammar import failed ${refreshes}`)
            })()
          : (async () => ({ tokens: EditorTokenStore.empty() }))(),
      dispose: () => undefined,
    }))

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    await vi.advanceTimersByTimeAsync(10 * RETRY_WINDOW_MS)

    // The first request, one retry on the same session, one on a reloaded session.
    expect(refreshes).toBe(3)
    expect(view.sessionsCreated()).toBe(2)
    expect(view.editor.getState().initialHighlightStatus).toBe('error')
    expect(view.actions('editor.syntax.highlight_request_failed')).toHaveLength(3)
    const terminal = view.actions('editor.syntax.highlight_retries_exhausted')
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({
      level: 'warn',
      error: { message: 'grammar import failed 3' },
      syntax: { attempts: 3 },
    })
    expect(view.paints.filter(isHighlightSettled).map((event) => event.status)).toEqual(['error'])
    view.dispose()
  })

  it('drops a retry whose document version was superseded', async () => {
    const staleRetry = deferred<EditorHighlightResult>()
    let refreshes = 0
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (() => {
              refreshes += 1
              if (refreshes === 1) return Promise.reject(new Error('worker restarted'))
              return staleRetry.promise
            })()
          : (async () => ({
              tokens: EditorTokenStore.fromTokens([{ start: 0, end: 1, style: RED }]),
            }))(),
      dispose: () => undefined,
    }))

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    expect(refreshes).toBe(2)

    view.editor.edit({ from: 0, to: 0, text: 'x' })
    staleRetry.resolve({
      tokens: EditorTokenStore.fromTokens([{ start: 6, end: 11, style: RED }]),
    })
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)

    expect(view.snapshots.some((snapshot) => hasToken(snapshot.tokens, [6, 11]))).toBe(false)
    expect(view.snapshots.at(-1)?.tokens).toEqual([[0, 1]])
    expect(view.editor.getState().initialHighlightStatus).toBe('painted')
    expect(view.actions('editor.syntax.highlight_retries_exhausted')).toHaveLength(0)
    view.dispose()
  })

  it('reloads the highlighter after an edit failure without spending refresh retries', async () => {
    let edits = 0
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (async () => ({ tokens: EditorTokenStore.empty() }))()
          : (async () => {
              edits += 1
              throw new Error('edit rejected')
            })(),
      dispose: () => undefined,
    }))
    await vi.advanceTimersByTimeAsync(0)
    expect(view.editor.getState().initialHighlightStatus).toBe('painted')

    view.editor.edit({ from: 0, to: 0, text: 'x' })
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)

    expect(edits).toBe(1)
    expect(view.sessionsCreated()).toBe(2)
    expect(view.editor.getState().initialHighlightStatus).toBe('painted')
    expect(view.actions('editor.syntax.highlight_request_failed')).toEqual([
      expect.objectContaining({ syntax: expect.objectContaining({ failedRefreshes: 0 }) }),
    ])
    expect(view.actions('editor.syntax.highlight_retries_exhausted')).toHaveLength(0)
    view.dispose()
  })

  it('starts a fresh ladder when an edit fails after the retries ran out', async () => {
    let refreshes = 0
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (async () => {
              refreshes += 1
              throw new Error('highlighter unavailable')
            })()
          : (() => Promise.reject(new Error('edit rejected')))(),
      dispose: () => undefined,
    }))
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    expect(view.actions('editor.syntax.highlight_retries_exhausted')).toHaveLength(1)

    view.editor.edit({ from: 0, to: 0, text: 'x' })
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)

    // The edit reloads once; its refresh runs the full ladder, which reloads once more.
    expect(refreshes).toBe(6)
    expect(view.sessionsCreated()).toBe(4)
    const terminal = view.actions('editor.syntax.highlight_retries_exhausted')
    expect(terminal.map((event) => (event.syntax as { attempts: number }).attempts)).toEqual([3, 3])
    expect(view.editor.getState().initialHighlightStatus).toBe('error')
    view.dispose()
  })

  it('settles as an error when the provider declines the reloaded session', async () => {
    let refreshes = 0
    let offered = 0
    const view = mountRetryEditor(
      (context) => {
        offered += 1
        if (offered > 1) return null
        return {
          analyze: (read) =>
            read.revision === context.initialRead.revision
              ? (async () => {
                  refreshes += 1
                  throw new Error('worker lost')
                })()
              : (async () => ({ tokens: EditorTokenStore.empty() }))(),
          dispose: () => undefined,
        }
      },
      [syntaxPlugin(syntaxSession(deferred<EditorSyntaxResult>()))],
    )

    await vi.advanceTimersByTimeAsync(10 * RETRY_WINDOW_MS)

    expect(refreshes).toBe(2)
    expect(view.sessionsCreated()).toBe(2)
    expect(view.editor.getState().initialHighlightStatus).toBe('error')
    const terminal = view.actions('editor.syntax.highlight_retries_exhausted')
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({
      error: { message: 'worker lost' },
      syntax: { attempts: 2 },
    })
    view.dispose()
  })

  it('starts a fresh ladder after a highlighter theme change and a new document', async () => {
    const themeListeners = new Set<() => void>()
    const view = mountRetryEditor((context) => ({
      analyze: (read) =>
        read.revision === context.initialRead.revision
          ? (() => Promise.reject(new Error('highlighter unavailable')))()
          : (() => Promise.reject(new Error('highlighter unavailable')))(),
      onDidChangeTheme: (listener) => {
        themeListeners.add(listener)
        return () => themeListeners.delete(listener)
      },
      dispose: () => undefined,
    }))
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    expect(view.actions('editor.syntax.highlight_retries_exhausted')).toHaveLength(1)

    for (const listener of themeListeners) listener()
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)
    view.editor.openDocument({ documentId: 'other.ts', languageId: 'typescript', text: TEXT })
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS)

    const terminal = view.actions('editor.syntax.highlight_retries_exhausted')
    expect(terminal.map((event) => (event.syntax as { attempts: number }).attempts)).toEqual([
      3, 3, 3,
    ])
    view.dispose()
  })
})

// Longer than the whole retry ladder's backoff.
const RETRY_WINDOW_MS = 2_000
const RED = { color: '#ff0000' }

function mountRetryEditor(
  openRuntime: (context: EditorHighlighterOperationContext) => EditorHighlighterRuntime | null,
  plugins: readonly EditorPlugin[] = [],
): {
  readonly editor: Editor
  readonly paints: EditorInitialPaintEvent[]
  readonly snapshots: Array<{ readonly tokens: readonly [number, number][] }>
  actions(action: string): EditorLogEvent[]
  sessionsCreated(): number
  dispose(): void
} {
  const events: EditorLogEvent[] = []
  const paints: EditorInitialPaintEvent[] = []
  const snapshots: Array<{
    readonly foregroundColor: string | null
    readonly status: EditorInitialHighlightStatus
    readonly tokens: readonly [number, number][]
  }> = []
  let sessions = 0
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, {
    plugins: [
      {
        activate: (context) =>
          context.registerHighlighter({
            operation: createEditorHighlighterOperation((context) => {
              sessions += 1
              return openRuntime(context)
            }),
          }),
      },
      themeSnapshotPlugin(snapshots),
      createEditorLoggingPlugin((event) => events.push(event)),
      ...plugins,
    ],
    onInitialPaint: (event) => paints.push(event),
  })
  editor.openDocument({ documentId: 'retry.ts', languageId: 'typescript', text: TEXT })
  return {
    editor,
    paints,
    snapshots,
    actions: (action) => events.filter((event) => event.action === action),
    sessionsCreated: () => sessions,
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}

function hasToken(tokens: readonly [number, number][], range: [number, number]): boolean {
  return tokens.some(([start, end]) => start === range[0] && end === range[1])
}

function highlighterPlugin(
  session: EditorHighlighterRuntime,
  loadTheme?: () => Promise<EditorTheme | null | undefined>,
): EditorPlugin {
  return {
    activate: (context) => {
      const provider = {
        operation: createEditorHighlighterOperation(() => session),
      }
      if (!loadTheme) return context.registerHighlighter(provider)
      return context.registerHighlighter({ ...provider, loadTheme })
    },
  }
}

function highlighterSession(
  result: ReturnType<typeof deferred<EditorHighlightResult>>,
): EditorHighlighterRuntime {
  return {
    analyze: (_read, signal) => {
      result.markStarted()
      return waitForDocumentWork(result.promise, signal)
    },
    dispose: () => undefined,
  }
}

function syntaxPlugin(session: EditorSyntaxRuntime): EditorPlugin {
  return {
    activate: (context) =>
      context.registerSyntaxProvider({
        operation: createEditorStructuralOperation(() => session),
      }),
  }
}

function syntaxSession(
  result: ReturnType<typeof deferred<EditorSyntaxResult>>,
): EditorSyntaxRuntime {
  return {
    analyze: (_read, signal) => {
      result.markStarted()
      return waitForDocumentWork(result.promise, signal)
    },
    getResult: () => createEmptySyntaxResult(),
    getTokens: () => [],
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    dispose: () => undefined,
  }
}

function statusSnapshotPlugin(statuses: EditorInitialHighlightStatus[]): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot) => statuses.push(snapshot.initialHighlightStatus),
          dispose: () => undefined,
        }),
      }),
  }
}

function themeSnapshotPlugin(
  snapshots: Array<{
    readonly foregroundColor: string | null
    readonly status: EditorInitialHighlightStatus
    readonly tokens: readonly [number, number][]
  }>,
): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot) => {
            snapshots.push({
              foregroundColor: snapshot.theme?.foregroundColor ?? null,
              status: snapshot.initialHighlightStatus,
              tokens: snapshot.tokens.toTokens().map((token) => [token.start, token.end]),
            })
          },
          dispose: () => undefined,
        }),
      }),
  }
}

function createSyntaxEditor(
  result: ReturnType<typeof deferred<EditorSyntaxResult>>,
  events: EditorInitialPaintEvent[],
): { readonly editor: Editor; dispose(): void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, {
    plugins: [syntaxPlugin(syntaxSession(result))],
    onInitialPaint: (event) => events.push(event),
  })
  editor.openDocument({ documentId: 'structural.ts', languageId: 'typescript', text: TEXT })
  return {
    editor,
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}

function snapshotOrderPlugin(order: string[]): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot, kind: EditorViewContributionUpdateKind) => {
            order.push(`snapshot:${kind}:${snapshot.initialHighlightStatus}`)
          },
          dispose: () => undefined,
        }),
      }),
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly started: Promise<void>
  markStarted(): void
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  void promise.catch(() => undefined)
  let markStarted = () => {}
  const started = new Promise<void>((done) => {
    markStarted = done
  })
  return { promise, reject, resolve, started, markStarted }
}

function isHighlightSettled(
  event: EditorInitialPaintEvent,
): event is Extract<EditorInitialPaintEvent, { phase: 'highlight-settled' }> {
  return event.phase === 'highlight-settled'
}

function isTextPaint(
  event: EditorInitialPaintEvent,
): event is Extract<EditorInitialPaintEvent, { phase: 'text' }> {
  return event.phase === 'text'
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}
