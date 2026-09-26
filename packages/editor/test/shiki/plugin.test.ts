import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestPluginContext } from '../../src/testContexts'

import { createDocumentTextSnapshot, createPieceTableSnapshot } from '../../src'
import type { EditorDisposable, EditorHighlighterProvider, EditorPlugin } from '../../src/plugins'
import {
  createShikiHighlighterPlugin,
  createShikiHighlighterProvider,
  type ShikiHighlighterPluginOptions,
  type ShikiHighlighterSessionOptions,
  type ShikiWorkerOwner,
} from '../../src/shiki'

const workerOwner = vi.hoisted(() => ({
  canUseWorker: vi.fn(() => true),
  createSession: vi.fn(() => null),
  dispose: vi.fn(async () => undefined),
  loadTheme: vi.fn(),
}))
const createShikiWorkerOwner = vi.hoisted(() => vi.fn(() => workerOwner))
const DEFAULT_SHIKI_WORKER_OWNER_KEY = Symbol.for(
  '@singapore-editor/core/shiki/default-worker-owner',
)

vi.mock('../../src/shiki/workerClient', () => ({
  createShikiWorkerOwner,
}))

describe('createShikiHighlighterPlugin', () => {
  beforeEach(() => {
    delete (globalThis as Record<PropertyKey, unknown>)[DEFAULT_SHIKI_WORKER_OWNER_KEY]
    createShikiWorkerOwner.mockClear()
    workerOwner.canUseWorker.mockClear()
    workerOwner.canUseWorker.mockReturnValue(true)
    workerOwner.createSession.mockClear()
    workerOwner.dispose.mockClear()
    workerOwner.loadTheme.mockClear()
  })

  it('maps .tsx TypeScript documents to Shiki TSX', () => {
    const provider = activateHighlighterProvider()
    const text = 'const el = <div className="x" />'

    provider.createSession({
      documentId: 'App.tsx',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(workerOwner.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'tsx',
      }),
    )
  })

  it('keeps the source extension when a secondary view adds a document fragment', () => {
    const provider = createShikiHighlighterProvider(pluginOptions())
    const text = 'const el = <div />'

    provider.createSession({
      documentId: 'App.tsx#diff-old',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(workerOwner.createSession).toHaveBeenCalledWith(expect.objectContaining({ lang: 'tsx' }))
  })

  it('creates a provider that can be shared without activating an editor plugin', () => {
    const provider = createShikiHighlighterProvider(pluginOptions())
    const text = 'const value = 1'

    provider.createSession({
      documentId: 'index.ts',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(workerOwner.createSession).toHaveBeenCalledTimes(1)
  })

  it('maps .jsx JavaScript documents to Shiki JSX', () => {
    const provider = activateHighlighterProvider()
    const text = 'const el = <div className="x" />'

    provider.createSession({
      documentId: 'App.jsx',
      languageId: 'javascript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(workerOwner.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'jsx',
      }),
    )
  })

  it('keeps explicit language overrides ahead of extension inference', () => {
    const provider = activateHighlighterProvider({
      languages: { typescript: 'typescript' },
    })
    const text = 'const el = <div className="x" />'

    provider.createSession({
      documentId: 'App.tsx',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(workerOwner.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'typescript',
      }),
    )
  })

  it('reuses one default worker owner across activations', () => {
    const first = activateHighlighterProvider({
      preloadLanguages: ['typescript', 'tsx'],
      preloadThemes: ['github-dark'],
    })
    const second = activateHighlighterProvider({
      preloadLanguages: ['tsx', 'typescript'],
      preloadThemes: ['github-dark'],
    })

    expect(createShikiWorkerOwner).toHaveBeenCalledTimes(1)
    expect(second).not.toBe(first)
  })

  it('keeps the default worker owner alive when the plugin disposes', () => {
    const disposables = activateWithDisposables()

    for (const disposable of disposables) disposable.dispose()

    expect(workerOwner.dispose).not.toHaveBeenCalled()
  })

  it('uses a provided worker owner for sessions without disposing it', () => {
    const sharedOwner = {
      canUseWorker: vi.fn(() => true),
      createSession: vi.fn(() => null),
      dispose: vi.fn(async () => undefined),
      loadTheme: vi.fn(),
    }
    const provider = activateHighlighterProvider({
      workerOwner: sharedOwner as unknown as ShikiWorkerOwner,
    })
    const text = 'const value = 1'

    provider.createSession({
      documentId: 'index.ts',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    expect(sharedOwner.createSession).toHaveBeenCalledTimes(1)
    expect(workerOwner.createSession).not.toHaveBeenCalled()
    expect(createShikiWorkerOwner).not.toHaveBeenCalled()
  })

  it('keeps a provided worker owner alive when the plugin disposes', () => {
    const sharedOwner = {
      canUseWorker: vi.fn(() => true),
      createSession: vi.fn(() => null),
      dispose: vi.fn(async () => undefined),
      loadTheme: vi.fn(),
    }
    const disposables = activateWithDisposables({
      workerOwner: sharedOwner as unknown as ShikiWorkerOwner,
    })

    for (const disposable of disposables) disposable.dispose()

    expect(sharedOwner.dispose).not.toHaveBeenCalled()
    expect(workerOwner.dispose).not.toHaveBeenCalled()
  })

  it('passes resolved theme registrations through to worker sessions', async () => {
    const themeRegistration = {
      name: 'my-custom-theme',
      colors: { 'editor.background': '#101010' },
      tokenColors: [],
    }
    const provider = activateHighlighterProvider({
      theme: 'my-custom-theme',
      resolveTheme: async () => themeRegistration,
    })
    const text = 'const value = 1'

    provider.createSession({
      documentId: 'index.ts',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    const call = workerOwner.createSession.mock.calls.at(-1) as unknown as
      | [ShikiHighlighterSessionOptions]
      | undefined
    const options = call?.[0]
    expect(options?.theme).toBe('my-custom-theme')
    await expect(options?.registrations).resolves.toMatchObject({
      themeRegistration: { name: 'my-custom-theme' },
    })
  })

  it('sends a session its own grammar only, even after the preload set has loaded', async () => {
    const provider = activateHighlighterProvider({ preloadLanguages: ['json', 'css'] })
    const text = 'const value = 1'
    const openSession = (documentId: string, languageId: string) => {
      provider.createSession({
        documentId,
        languageId,
        textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
        snapshot: createPieceTableSnapshot(text),
      })
      const call = workerOwner.createSession.mock.calls.at(-1) as unknown as [
        ShikiHighlighterSessionOptions,
      ]
      return call[0]
    }

    const first = openSession('first.ts', 'typescript')
    const preload = first.preloadRegistrations
    if (typeof preload !== 'function') throw new Error('expected a lazy preload')
    await expect(preload()).resolves.toMatchObject({
      languageRegistrations: [{ name: 'typescript' }, { name: 'json' }, { name: 'css' }],
    })

    const second = openSession('second.html', 'html')
    const registrations = await second.registrations
    expect(registrations.languageRegistrations.map((registration) => registration.name)).toEqual([
      'html',
    ])
  })

  it('requires a non-empty name on resolved theme registrations', async () => {
    const provider = activateHighlighterProvider({
      resolveTheme: async () => ({ name: '' }),
    })
    const text = 'const value = 1'

    provider.createSession({
      documentId: 'index.ts',
      languageId: 'typescript',
      textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text), text),
      snapshot: createPieceTableSnapshot(text),
    })

    const call = workerOwner.createSession.mock.calls.at(-1) as unknown as
      | [ShikiHighlighterSessionOptions]
      | undefined
    const options = call?.[0]
    await expect(options?.registrations).rejects.toThrow(
      'Shiki theme registrations require a non-empty name',
    )
  })
})

function activateHighlighterProvider(
  options: Partial<ShikiHighlighterPluginOptions> = {},
): EditorHighlighterProvider {
  let provider: EditorHighlighterProvider | null = null
  const context = createTestPluginContext({
    registerHighlighter: (nextProvider) => {
      provider = nextProvider
      return { dispose: () => undefined }
    },
  })

  createShikiHighlighterPlugin(pluginOptions(options)).activate(context)
  if (!provider) throw new Error('Expected Shiki plugin to register a highlighter')
  return provider
}

function activateWithDisposables(
  options: Partial<ShikiHighlighterPluginOptions> = {},
): readonly EditorDisposable[] {
  return toDisposables(
    createShikiHighlighterPlugin(pluginOptions(options)).activate(createTestPluginContext()),
  )
}

function pluginOptions(
  overrides: Partial<ShikiHighlighterPluginOptions> = {},
): ShikiHighlighterPluginOptions {
  return {
    resolveLanguage: async (language) => [languageRegistration(language)],
    resolveTheme: async (theme) => ({ name: theme }),
    ...overrides,
  }
}

function languageRegistration(name: string) {
  return {
    name,
    patterns: [],
    repository: {},
    scopeName: `source.${name}`,
  }
}

function toDisposables(result: ReturnType<EditorPlugin['activate']>): readonly EditorDisposable[] {
  if (!result) return []
  // `dispose` only exists on the single-disposable arm of the activate() union.
  return 'dispose' in result ? [result] : result
}
