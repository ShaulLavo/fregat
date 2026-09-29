import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentEditChain } from '../src/editor/editChain'
import { createDocumentSession } from '../src/documentSession'
import { EditorSyntaxController, fallbackFoldReason } from '../src/editor/syntaxController'
import { EditorPluginHost, type EditorLogInput, type EditorPlugin } from '../src/plugins'
import {
  createEmptySyntaxResult,
  type EditorSyntaxFoldingSupport,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
} from '../src/syntax/session'
import { EditorTokenStore } from '../src/syntax/tokenStore'

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
})

describe('fallback folding ownership', () => {
  it('distinguishes missing language, absent providers and a declined session', () => {
    expect(controller({ languageId: null }).syntax.fallbackFoldReason).toBe('no-language')
    expect(controller({}).syntax.fallbackFoldSelection).toMatchObject({
      reason: 'no-session',
      provider: null,
      structuralSession: false,
    })
    expect(
      controller({ plugins: [structuralPlugin(null)] }).syntax.fallbackFoldSelection,
    ).toMatchObject({ reason: 'no-session', provider: 'plugin', structuralSession: false })
  })

  it('keeps fallback ownership with a highlighter alone', () => {
    const fixture = controller({
      plugins: [
        {
          activate: (context) =>
            context.registerHighlighter({
              createSession: () => ({
                refresh: async () => ({ tokens: EditorTokenStore.empty() }),
                applyChange: async () => ({ tokens: EditorTokenStore.empty() }),
                dispose: () => undefined,
              }),
            }),
        },
      ],
    })

    expect(fixture.syntax.fallbackFoldReason).toBe('no-session')
  })

  it('selects unsupported sessions and reports the policy in the existing syntax event', () => {
    const fixture = controller({ plugins: [structuralPlugin(structuralSession('unsupported'))] })

    expect(fixture.syntax.usesFallbackFolds).toBe(true)
    expect(fixture.logs).toContainEqual(
      expect.objectContaining({
        action: 'editor.syntax.document_started',
        syntax: expect.objectContaining({
          reason: 'unsupported',
          foldingSupport: 'unsupported',
          structuralStatus: 'loading',
          structuralSuppression: false,
        }),
      }),
    )
  })

  it.each(['pending', 'supported'] as const)(
    'suppresses fallback during %s support before any viewport coverage',
    (support) => {
      const fixture = controller({ plugins: [structuralPlugin(structuralSession(support))] })

      expect(fixture.syntax.status).toBe('loading')
      expect(fixture.syntax.fallbackFoldReason).toBeNull()
      expect(fixture.syntax.usesFallbackFolds).toBe(false)
    },
  )

  it.each(['pending', 'supported'] as const)(
    'keeps an existing %s session authoritative when a provider accepted no language',
    (foldingSupport) => {
      expect(
        fallbackFoldReason({
          languageId: null,
          session: { foldingSupport },
          status: 'loading',
        }),
      ).toBeNull()
    },
  )

  it('treats a supported empty result as authoritative', async () => {
    const fixture = controller({ plugins: [structuralPlugin(structuralSession('supported'))] })
    fixture.syntax.refresh(1, null, { delayMs: 0 })
    await vi.waitFor(() => expect(fixture.syntax.status).toBe('ready'))

    expect(fixture.syntax.usesFallbackFolds).toBe(false)
    expect(fixture.syntax.fallbackFoldReason).toBeNull()
  })

  it('keeps fallback suppressed when a completed parse no longer covers the viewport', async () => {
    const first = deferred<EditorSyntaxResult>()
    const next = deferred<EditorSyntaxResult>()
    const queryRange = vi.fn(() => next.promise).mockReturnValueOnce(first.promise)
    const fixture = controller({
      plugins: [structuralPlugin({ ...structuralSession('supported'), queryRange })],
    })
    fixture.setVisibleRange({ startIndex: 0, endIndex: 4 })
    fixture.syntax.refresh(1, null, { delayMs: 0 })
    await vi.waitFor(() => expect(queryRange).toHaveBeenCalledTimes(1))
    fixture.setVisibleRange({ startIndex: 9, endIndex: 17 })

    first.resolve(createEmptySyntaxResult())
    await vi.waitFor(() => expect(queryRange).toHaveBeenCalledTimes(2))

    expect(fixture.syntax.status).toBe('loading')
    expect(fixture.syntax.usesFallbackFolds).toBe(false)
    expect(fixture.syntax.fallbackFoldReason).toBeNull()
  })

  it('uses fallback after a terminal parser failure and suppresses it after recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const providerSession = structuralSession('supported')
    const refresh = vi.fn(providerSession.refresh)
    refresh.mockRejectedValueOnce(new TypeError('Parser failed'))
    const fixture = controller({
      plugins: [structuralPlugin({ ...providerSession, refresh })],
    })

    fixture.syntax.refresh(1, null, { delayMs: 0 })
    await vi.waitFor(() => expect(fixture.syntax.fallbackFoldReason).toBe('structural-error'))
    expect(fixture.syntax.usesFallbackFolds).toBe(true)

    fixture.syntax.refresh(1, null, { delayMs: 0 })
    expect(fixture.syntax.usesFallbackFolds).toBe(false)
    await vi.waitFor(() => expect(fixture.syntax.status).toBe('ready'))
    expect(fixture.syntax.usesFallbackFolds).toBe(false)
  })
})

function controller(options: {
  readonly languageId?: string | null
  readonly plugins?: readonly EditorPlugin[]
}) {
  const languageId = options.languageId === undefined ? 'typescript' : options.languageId
  const session = createDocumentSession('root\n  child\nnext\n')
  const pluginHost = new EditorPluginHost(options.plugins)
  const logs: EditorLogInput[] = []
  let visibleRange: EditorSyntaxRange = { startIndex: 0, endIndex: session.getSnapshot().length }
  const syntax = new EditorSyntaxController({
    pluginHost,
    getDocumentVersion: () => 1,
    getDocumentId: () => 'fold-policy',
    getTextVersion: () => 0,
    getCurrentSessionDocumentId: () => 'fold-policy',
    getLanguageId: () => languageId,
    getSession: () => session,
    getDocumentEditChain: () => new DocumentEditChain(0, 0),
    getVisibleSyntaxRange: () => visibleRange,
    adoptTokens: () => undefined,
    clearSyntaxFolds: () => undefined,
    setSyntaxFolds: () => undefined,
    notifyChange: () => undefined,
    notifyViewUpdate: () => undefined,
    notifyThemeChanged: () => undefined,
    log: (event) => logs.push(event),
  })
  syntax.startDocument({
    documentId: 'fold-policy',
    languageId,
    snapshot: session.getSnapshot(),
    textSnapshot: session.getTextSnapshot(),
  })
  disposers.push(() => {
    syntax.dispose()
    pluginHost.dispose()
  })
  return {
    syntax,
    logs,
    setVisibleRange: (range: EditorSyntaxRange) => {
      visibleRange = range
    },
  }
}

function structuralPlugin(session: EditorSyntaxSession | null): EditorPlugin {
  return {
    activate: (context) => context.registerSyntaxProvider({ createSession: () => session }),
  }
}

function structuralSession(foldingSupport: EditorSyntaxFoldingSupport): EditorSyntaxSession {
  const result = createEmptySyntaxResult()
  return {
    foldingSupport,
    refresh: async () => result,
    applyChange: async () => result,
    getResult: () => result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose: () => undefined,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
