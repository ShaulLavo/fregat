import { createEditorHighlighterOperation } from '../src/editor/operationDefinitions'
import { describe, expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
import {
  createEditorDocumentAnalysis,
  readRetainedHighlighterResult,
} from '../src/editor/documentAnalysis'
import { captureThemeCohort, loadOrderedHighlighterTheme } from '../src/syntax/providerTheme'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { EditorSyntaxController } from '../src/editor/syntaxController'
import { EditorPluginHost } from '../src/plugins'

describe('retained provider theme admission', () => {
  it('keeps produced token ownership current while a shared theme is pending', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'produced' })
    let configuration = 0
    let resolve!: (theme: null) => void
    const theme = new Promise<null>((complete) => {
      resolve = complete
    })
    const provider: EditorHighlighterProvider = {
      loadTheme: () => theme,
      operation: createEditorHighlighterOperation(() => ({
        configurationKey: () => configuration,
        analyze: async () => ({
          tokens: EditorTokenStore.fromTokens([{ start: 0, end: 1, style: { color: 'red' } }]),
        }),
        dispose: () => undefined,
      })),
    }
    const first = analysis.borrowHighlighter({ provider, languageId: 'typescript' })!
    const peer = analysis.borrowHighlighter({ provider, languageId: 'typescript' })!
    let notifications = 0
    first.onDidProduceTokens(() => {
      notifications++
    })
    const initial = first.refresh(buffer.getTextSnapshot())
    const cancelledInitial = expect(initial).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await vi.waitFor(() => expect(first.readProducedTokens()?.tokens.length).toBe(1))
      expect(first.read().kind).toBe('pending')
      expect(analysis.inspectRetention().entries[0]).toMatchObject({
        status: 'pending',
        tokenCount: 1,
      })
      expect(notifications).toBe(1)
      configuration++
      expect(first.readProducedTokens()).toBeNull()
      first.dispose()
      const next = peer.refresh(buffer.getTextSnapshot())
      const cancelledNext = expect(next).rejects.toMatchObject({ name: 'AbortError' })
      await cancelledInitial
      await vi.waitFor(() => expect(peer.readProducedTokens()?.tokens.length).toBe(1))
      expect(first.readProducedTokens()).toBeNull()
      expect(notifications).toBe(1)
      peer.dispose()
      analysis.reclaimInactive({ reason: 'inactive-budget' })
      await cancelledNext
      expect(analysis.inspectRetention().entries).toEqual([])
    } finally {
      resolve(null)
      first.dispose()
      peer.dispose()
      analysis.dispose()
    }
  })

  it('joins pending public controller retries and rejects a late replaced theme through the same owner', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const session = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'controller-retry' })
    let release!: (theme: { foregroundColor: string }) => void
    const held = new Promise<{ foregroundColor: string }>((resolve) => {
      release = resolve
    })
    let mode: 'failed' | 'held' | 'healthy' = 'failed'
    const listeners = new Set<() => void>()
    const loader = vi.fn(async () => {
      if (mode === 'failed') throw new TypeError('external theme failure')
      if (mode === 'held') return held
      return { foregroundColor: '#abcdef' }
    })
    const provider: EditorHighlighterProvider = {
      loadTheme: loader,
      operation: createEditorHighlighterOperation(() => ({
        analyze: async () => ({ tokens: EditorTokenStore.empty() }),
        onDidChangeTheme: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        dispose: () => undefined,
      })),
    }
    const plugins = new EditorPluginHost([
      { activate: (context) => context.registerHighlighter(provider) },
    ])
    const syntax = new EditorSyntaxController({
      pluginHost: plugins,
      getSession: () => session,
      getDocumentVersion: () => 1,
      getTextVersion: () => buffer.getRevision(),
      getDocumentId: () => 'controller-retry',
      getCurrentSessionDocumentId: () => 'controller-retry',
      getLanguageId: () => 'typescript',
      getVisibleSyntaxRange: () => ({ startIndex: 0, endIndex: buffer.getSnapshot().length }),
      adoptTokens: () => undefined,
      setSyntaxFolds: () => undefined,
      clearSyntaxFolds: () => undefined,
      notifyViewUpdate: () => undefined,
      notifyChange: () => undefined,
      notifyThemeChanged: () => undefined,
    })
    const peer = analysis.borrowHighlighter({ provider, languageId: 'typescript' })!
    try {
      syntax.startDocument({
        analysis,
        documentId: 'controller-retry',
        languageId: 'typescript',
        snapshot: session.getSnapshot(),
        textSnapshot: session.getTextSnapshot(),
      })
      await peer.refresh(buffer.getTextSnapshot())
      syntax.adoptReadyAnalysis()
      expect(syntax.providerTheme).toBeNull()
      expect(loader).toHaveBeenCalledTimes(1)
      mode = 'held'
      syntax.refreshHighlighterTheme()
      syntax.refreshHighlighterTheme()
      const pending = peer.refresh(buffer.getTextSnapshot())
      const obsolete = pending.then(
        () => 'ready',
        () => 'rejected',
      )
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
      expect(peer.read().kind).toBe('pending')
      expect(syntax.initialHighlightStatus).toBe('loading')
      expect(syntax.renderDataReady).toBe(false)
      mode = 'healthy'
      for (const listener of listeners) listener()
      syntax.refreshHighlighterTheme()
      await peer.refresh(buffer.getTextSnapshot())
      await vi.waitFor(() => expect(syntax.providerTheme).toEqual({ foregroundColor: '#abcdef' }))
      expect(await obsolete).toBe('rejected')
      expect(loader).toHaveBeenCalledTimes(3)
      release({ foregroundColor: '#111111' })
      await Promise.resolve()
      expect(syntax.providerTheme).toEqual({ foregroundColor: '#abcdef' })
      expect(syntax.initialHighlightStatus).toBe('painted')
    } finally {
      release({ foregroundColor: '#111111' })
      peer.dispose()
      syntax.dispose()
      plugins.dispose()
      analysis.dispose()
    }
  })

  it('keeps failed reads passive and deduplicates explicit refresh through compatible callers', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'public-retry' })
    let resolve!: (theme: { foregroundColor: string }) => void
    const healthy = new Promise<{ foregroundColor: string }>((complete) => {
      resolve = complete
    })
    const failure = new TypeError('external theme failed')
    const loader = vi
      .fn(() => healthy)
      .mockImplementationOnce(async () => {
        throw failure
      })
    const request = { provider: themeProvider(loader), languageId: 'typescript' }
    const first = analysis.borrowHighlighter(request)!
    let peer = analysis.borrowHighlighter(request)!
    try {
      await first.refresh(buffer.getTextSnapshot())
      expect(first.read()).toMatchObject({ kind: 'ready', providerTheme: { kind: 'failed' } })
      peer.dispose()
      peer = analysis.borrowHighlighter(request)!
      await readRetainedHighlighterResult(peer, buffer.getTextSnapshot())
      expect(loader).toHaveBeenCalledTimes(1)

      const retry = first.refresh(buffer.getTextSnapshot())
      const joined = peer.refresh(buffer.getTextSnapshot())
      expect(first.read().kind).toBe('pending')
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
      expect(peer.read().kind).toBe('pending')
      resolve({ foregroundColor: '#abcdef' })
      await Promise.all([retry, joined])
      expect(first.runtimeSessionId).toBe(peer.runtimeSessionId)
      expect(first.read()).toMatchObject({
        kind: 'ready',
        providerTheme: { kind: 'ready', theme: { foregroundColor: '#abcdef' } },
      })
      expect(loader).toHaveBeenCalledTimes(2)
      const change = createEditorBufferSession(buffer).applyText('!')
      await peer.applyChange(change)
      await first.refresh(buffer.getTextSnapshot())
      expect(loader).toHaveBeenCalledTimes(2)
    } finally {
      resolve({ foregroundColor: '#abcdef' })
      first.dispose()
      peer.dispose()
      analysis.dispose()
    }
  })

  it('rejects a changed pending cohort before invoking its lower-priority loader', async () => {
    let resolve!: (value: undefined) => void
    const pending = new Promise<undefined>((complete) => {
      resolve = complete
    })
    const first = vi.fn(() => pending)
    const oldLower = vi.fn(async () => ({ foregroundColor: '#123456' }))
    const newLower = vi.fn(async () => ({ foregroundColor: '#abcdef' }))
    const lower = themeProvider(oldLower)
    const result = loadOrderedHighlighterTheme(captureThemeCohort([themeProvider(first), lower]))
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    lower.loadTheme = newLower
    resolve(undefined)
    await rejected
    expect(oldLower).not.toHaveBeenCalled()
    expect(newLower).not.toHaveBeenCalled()
  })

  it.each(['undefined', 'null', 'failed'] as const)(
    'preserves ordered %s loader semantics',
    async (first) => {
      const failure = new TypeError('external loader failure')
      const primary = vi.fn(async () => {
        if (first === 'failed') throw failure
        return first === 'null' ? null : undefined
      })
      const secondary = vi.fn(async () => ({ gutterForegroundColor: '#123456' }))
      const tertiary = vi.fn(async () => ({ foregroundColor: '#abcdef' }))
      const providers = [
        themeProvider(),
        themeProvider(primary),
        themeProvider(secondary),
        themeProvider(tertiary),
      ]
      const result = loadOrderedHighlighterTheme(captureThemeCohort(providers))
      if (first === 'failed') await expect(result).rejects.toBe(failure)
      if (first === 'null') await expect(result).resolves.toBeNull()
      if (first === 'undefined')
        await expect(result).resolves.toEqual({ gutterForegroundColor: '#123456' })
      expect(primary).toHaveBeenCalledTimes(1)
      expect(secondary).toHaveBeenCalledTimes(first === 'undefined' ? 1 : 0)
      expect(tertiary).not.toHaveBeenCalled()
    },
  )

  it('reuses certified theme across text generations and reacquires on an explicit theme refresh', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'theme' })
    const loadTheme = vi.fn(async () => ({ foregroundColor: '#123456' }))
    let themeChanged: () => void = () => undefined
    const provider: EditorHighlighterProvider = {
      ...themeProvider(loadTheme),
      operation: createEditorHighlighterOperation(() => ({
        analyze: async () => ({ tokens: EditorTokenStore.empty() }),
        onDidChangeTheme: (listener) => {
          themeChanged = listener
          return () => undefined
        },
        dispose: () => undefined,
      })),
    }
    const request = { provider, languageId: 'typescript', configurationTag: ['dark'] }
    const lease = analysis.borrowHighlighter(request)!
    try {
      await lease.refresh(buffer.getTextSnapshot())
      expect(lease.read()).toMatchObject({
        kind: 'ready',
        providerTheme: { kind: 'ready', theme: { foregroundColor: '#123456' } },
      })
      for (let edit = 0; edit < 3; edit++) {
        const change = createEditorBufferSession(buffer).applyText('!')
        await lease.applyChange(change)
        expect(lease.read()).toMatchObject({ kind: 'ready', revision: buffer.getRevision() })
      }
      expect(loadTheme).toHaveBeenCalledTimes(1)
      const id = lease.runtimeSessionId
      lease.dispose()
      const warm = analysis.borrowHighlighter(request)!
      await warm.refresh(buffer.getTextSnapshot())
      expect(warm.runtimeSessionId).toBe(id)
      expect(loadTheme).toHaveBeenCalledTimes(1)
      themeChanged()
      expect(warm.read().kind).toBe('pending')
      await warm.refresh(buffer.getTextSnapshot())
      expect(loadTheme).toHaveBeenCalledTimes(2)
      warm.dispose()
    } finally {
      lease.dispose()
      analysis.dispose()
    }
  })

  it('matches the entire ordered cohort and each captured loader identity', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'cohort' })
    const primary = themeProvider()
    const secondary = themeProvider(vi.fn(async () => ({ foregroundColor: '#123456' })))
    const request = {
      provider: primary,
      themeProviders: [primary, secondary],
      languageId: 'typescript',
    }
    const first = analysis.borrowHighlighter(request)!
    try {
      await first.refresh(buffer.getTextSnapshot())
      const reordered = analysis.borrowHighlighter({
        ...request,
        themeProviders: [secondary, primary],
      })!
      expect(reordered.runtimeSessionId).not.toBe(first.runtimeSessionId)
      reordered.dispose()
      secondary.loadTheme = vi.fn(async () => ({ foregroundColor: '#abcdef' }))
      expect(first.read().kind).toBe('failed')
      const replaced = analysis.borrowHighlighter(request)!
      await replaced.refresh(buffer.getTextSnapshot())
      expect(replaced.runtimeSessionId).not.toBe(first.runtimeSessionId)
      expect(replaced.read()).toMatchObject({
        kind: 'ready',
        providerTheme: { theme: { foregroundColor: '#abcdef' } },
      })
      replaced.dispose()
    } finally {
      first.dispose()
      analysis.dispose()
    }
  })

  it('prevents an unstarted producer on cancellation without claiming an invoked one was stopped', async () => {
    const loader = vi.fn(async () => ({ foregroundColor: '#123456' }))
    const abort = new AbortController()
    const result = loadOrderedHighlighterTheme(
      captureThemeCohort([themeProvider(loader)]),
      abort.signal,
    )
    abort.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(loader).not.toHaveBeenCalled()
  })

  it('rejects an invoked loader after disposal and stops the remaining ordered cohort', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'disposed-theme' })
    let resolve!: (theme: undefined) => void
    const pending = new Promise<undefined>((complete) => {
      resolve = complete
    })
    const loader = vi.fn(() => pending)
    const primary = themeProvider(loader)
    const secondaryLoader = vi.fn(async () => ({ foregroundColor: '#abcdef' }))
    const lease = analysis.borrowHighlighter({
      provider: primary,
      themeProviders: [primary, themeProvider(secondaryLoader)],
      languageId: 'typescript',
    })!
    const result = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    lease.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget' })
    resolve(undefined)
    await rejected
    await Promise.resolve()
    expect(secondaryLoader).not.toHaveBeenCalled()
    expect(analysis.inspectRetention().entries).toEqual([])
    analysis.dispose()
  })

  it('rejects obsolete tokens while reusing their still-compatible pending theme', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'source-theme' })
    let resolve!: (theme: { foregroundColor: string }) => void
    const pending = new Promise<{ foregroundColor: string }>((complete) => {
      resolve = complete
    })
    const loader = vi
      .fn(async () => ({ foregroundColor: '#abcdef' }))
      .mockImplementationOnce(() => pending)
    const lease = analysis.borrowHighlighter({
      provider: themeProvider(loader),
      languageId: 'typescript',
    })!
    const initial = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(initial).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    const change = createEditorBufferSession(buffer).applyText('!')
    const current = lease.applyChange(change)
    resolve({ foregroundColor: '#111111' })
    await rejected
    await current
    expect(loader).toHaveBeenCalledTimes(1)
    expect(lease.read()).toMatchObject({
      kind: 'ready',
      revision: buffer.getRevision(),
      providerTheme: { theme: { foregroundColor: '#111111' } },
    })
    lease.dispose()
    analysis.dispose()
  })

  it('invalidates a pending configuration theme on explicit retry without waiting for its late producer', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'retry-theme' })
    let resolve!: (theme: { foregroundColor: string }) => void
    const pending = new Promise<{ foregroundColor: string }>((complete) => {
      resolve = complete
    })
    const loader = vi
      .fn(async () => ({ foregroundColor: '#abcdef' }))
      .mockImplementationOnce(() => pending)
    let retry: () => void = () => undefined
    const provider: EditorHighlighterProvider = {
      ...themeProvider(loader),
      operation: createEditorHighlighterOperation(() => ({
        analyze: async () => ({ tokens: EditorTokenStore.empty() }),
        onDidChangeTheme: (listener) => {
          retry = listener
          return () => undefined
        },
        dispose: () => undefined,
      })),
    }
    const lease = analysis.borrowHighlighter({ provider, languageId: 'typescript' })!
    const initial = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(initial).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
      retry()
      await rejected
      await lease.refresh(buffer.getTextSnapshot())
      expect(loader).toHaveBeenCalledTimes(2)
      expect(lease.read()).toMatchObject({
        kind: 'ready',
        providerTheme: { theme: { foregroundColor: '#abcdef' } },
      })
      resolve({ foregroundColor: '#111111' })
      await Promise.resolve()
      expect(lease.read()).toMatchObject({
        kind: 'ready',
        providerTheme: { theme: { foregroundColor: '#abcdef' } },
      })
    } finally {
      resolve({ foregroundColor: '#111111' })
      lease.dispose()
      analysis.dispose()
    }
  })

  it('terminates a token-failed combined operation on owner cancellation without leaking theme work', async () => {
    const buffer = createEditorTextBuffer('alpha')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'token-failed-theme' })
    let resolve!: (theme: null) => void
    const pending = new Promise<null>((complete) => {
      resolve = complete
    })
    const loader = vi.fn(() => pending)
    const provider: EditorHighlighterProvider = {
      loadTheme: loader,
      operation: createEditorHighlighterOperation(() => ({
        analyze: async () => {
          throw new TypeError('external token provider failed')
        },
        dispose: () => undefined,
      })),
    }
    const lease = analysis.borrowHighlighter({ provider, languageId: 'typescript' })!
    const result = lease.refresh(buffer.getTextSnapshot())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    expect(lease.read().kind).toBe('pending')
    lease.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget' })
    await rejected
    resolve(null)
    expect(analysis.inspectRetention().entries).toEqual([])
    expect(loader).toHaveBeenCalledTimes(1)
    analysis.dispose()
  })
})

function themeProvider(
  loadTheme?: EditorHighlighterProvider['loadTheme'],
): EditorHighlighterProvider {
  return {
    loadTheme,
    operation: createEditorHighlighterOperation(() => ({
      analyze: async () => ({ tokens: EditorTokenStore.empty() }),
      dispose: () => undefined,
    })),
  }
}
