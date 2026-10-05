import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestPluginContext } from '../../src/testContexts'
import { createEditorTextBuffer } from '../../src/documentSession'
import {
  createEditorDocumentAnalysis,
  type EditorDocumentAnalysis,
} from '../../src/editor/documentAnalysis'
import { DocumentWorkerReader } from '../../src/document/workerReader'
import { packEditorTokens } from '../../src/syntax/packedTokens'
import type { EditorHighlighterProvider } from '../../src/syntax/highlighter'
import type { EditorPlugin } from '../../src/plugins'
import {
  createShikiHighlighterPlugin,
  createShikiHighlighterProvider,
  shikiLanguageForDocument,
  type ShikiHighlighterPluginOptions,
} from '../../src/shiki'
import { createShikiWorkerOwner, ShikiWorkerOwner } from '../../src/shiki/workerClient'
import type {
  ShikiWorkerRequest,
  ShikiWorkerResponse,
  ShikiWorkerOpenRequest,
} from '../../src/shiki/workerTypes'

const defaultOwnerKey = Symbol.for('@singapore-editor/core/shiki/default-worker-owner')
const workers: ConfigurationWorker[] = []
const analyses: EditorDocumentAnalysis[] = []
const owners = new Set<ShikiWorkerOwner>()

class ConfigurationWorker extends EventTarget implements Worker {
  readonly reader = new DocumentWorkerReader()
  readonly requests: ShikiWorkerRequest[] = []
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  onmessageerror: Worker['onmessageerror'] = null
  constructor() {
    super()
    workers.push(this)
  }
  postMessage(request: ShikiWorkerRequest): void {
    this.requests.push(request)
    const payload = request.payload
    const result =
      payload.type === 'source'
        ? { source: this.reader.apply(payload.command) }
        : payload.type === 'open' || payload.type === 'edit'
          ? { tokensPacked: packEditorTokens([]) }
          : undefined
    const reply: ShikiWorkerResponse = { id: request.id, ok: true, result }
    queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', { data: reply })))
  }
  terminate(): void {
    this.reader.dispose()
  }
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, defaultOwnerKey)
  vi.stubGlobal('Worker', ConfigurationWorker)
})
afterEach(async () => {
  for (const analysis of analyses.splice(0)) analysis.dispose()
  const shared: unknown = Reflect.get(globalThis, defaultOwnerKey)
  if (shared instanceof ShikiWorkerOwner) owners.add(shared)
  for (const owner of owners) await owner.dispose()
  owners.clear()
  workers.length = 0
  Reflect.deleteProperty(globalThis, defaultOwnerKey)
  vi.unstubAllGlobals()
})

function options(
  overrides: Partial<ShikiHighlighterPluginOptions> = {},
): ShikiHighlighterPluginOptions {
  return {
    resolveLanguage: async (name) => [
      { name, patterns: [], repository: {}, scopeName: `source.${name}` },
    ],
    resolveTheme: async (name) => ({ name }),
    ...overrides,
  }
}
function activate(overrides: Partial<ShikiHighlighterPluginOptions> = {}) {
  const registered: EditorHighlighterProvider[] = []
  const context = createTestPluginContext({
    registerHighlighter: (next) => {
      registered.push(next)
      return { dispose: () => {} }
    },
  })
  createShikiHighlighterPlugin(options(overrides)).activate(context)
  const provider = registered.at(-1)
  if (!provider) throw new TypeError('The plugin must register its typed highlighter operation')
  return provider
}
function defaultOwner(): ShikiWorkerOwner {
  const owner: unknown = Reflect.get(globalThis, defaultOwnerKey)
  if (!(owner instanceof ShikiWorkerOwner))
    throw new TypeError('The activated plugin must retain its default owner')
  return owner
}
function explicitOwner() {
  const owner = createShikiWorkerOwner()
  owners.add(owner)
  return owner
}
function borrow(
  provider: EditorHighlighterProvider,
  documentId = 'index.ts',
  languageId = 'typescript',
) {
  const buffer = createEditorTextBuffer('const value = 1')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId })
  analyses.push(analysis)
  const session = analysis.borrowHighlighter({ provider, languageId })
  if (!session) throw new TypeError('The configured worker must admit its highlighter')
  return { session, buffer }
}
async function opened(
  provider: EditorHighlighterProvider,
  documentId?: string,
  languageId?: string,
): Promise<ShikiWorkerOpenRequest> {
  const { session, buffer } = borrow(provider, documentId, languageId)
  await session.refresh(buffer.getTextSnapshot())
  const payload = workers
    .flatMap((worker) => worker.requests)
    .findLast((request) => request.payload.type === 'open')?.payload
  if (payload?.type !== 'open')
    throw new TypeError('The operation must dispatch an open to its external worker')
  return payload
}
function disposables(result: ReturnType<EditorPlugin['activate']>) {
  return !result ? [] : 'dispose' in result ? [result] : result
}

describe('Shiki plugin contributions', () => {
  it.each([
    ['App.tsx', 'typescript', 'tsx'],
    ['App.tsx#diff-old', 'typescript', 'tsx'],
    ['App.jsx', 'javascript', 'jsx'],
    ['index.ts', 'typescript', 'typescript'],
  ])('routes %s / %s to %s through a retained operation', async (documentId, languageId, lang) => {
    expect((await opened(activate(), documentId, languageId)).lang).toBe(lang)
  })
  it('keeps an explicit language override ahead of extension inference', async () => {
    expect(
      (await opened(activate({ languages: { typescript: 'typescript' } }), 'App.tsx')).lang,
    ).toBe('typescript')
  })
  it('shares a provider without activating an editor plugin', async () => {
    const owner = explicitOwner()
    const provider = createShikiHighlighterProvider(options({ workerOwner: owner }))
    expect((await opened(provider)).lang).toBe('typescript')
    expect(owner.inspect().workerGeneration).toBe(1)
  })
  it('reuses the default owner across distinct plugin activations', () => {
    const first = activate({
      preloadLanguages: ['typescript', 'tsx'],
      preloadThemes: ['github-dark'],
    })
    const owner = defaultOwner()
    const second = activate({
      preloadLanguages: ['tsx', 'typescript'],
      preloadThemes: ['github-dark'],
    })
    expect(defaultOwner()).toBe(owner)
    expect(first.operation).not.toBe(second.operation)
  })
  it.each(['default', 'provided'] as const)(
    'keeps the %s owner alive after plugin disposal',
    async (kind) => {
      const owner = kind === 'provided' ? explicitOwner() : undefined
      const result = createShikiHighlighterPlugin(options({ workerOwner: owner })).activate(
        createTestPluginContext(),
      )
      const retained = owner ?? defaultOwner()
      for (const disposable of disposables(result)) disposable.dispose()
      expect(retained.inspect().lifecycle).not.toBe('disposed')
      expect(
        (await opened(createShikiHighlighterProvider(options({ workerOwner: retained })))).lang,
      ).toBe('typescript')
    },
  )
  it('uses a provided owner without creating a default one', async () => {
    const owner = explicitOwner()
    await opened(activate({ workerOwner: owner }))
    expect(owner.inspect().workerGeneration).toBe(1)
    expect(Reflect.has(globalThis, defaultOwnerKey)).toBe(false)
  })
  it('delivers the resolved named theme registration', async () => {
    const theme = { name: 'custom', colors: { 'editor.background': '#101010' }, tokenColors: [] }
    const result = await opened(activate({ theme: 'custom', resolveTheme: async () => theme }))
    expect(result).toMatchObject({ theme: 'custom', themeRegistration: theme })
  })
  it('opens each document with its own grammar after preload completes', async () => {
    const owner = explicitOwner()
    const provider = activate({ workerOwner: owner, preloadLanguages: ['json', 'css'] })
    await opened(provider)
    await owner.awaitIdleFence()
    await vi.waitFor(() =>
      expect(
        workers
          .flatMap((worker) => worker.requests)
          .some((request) => request.payload.type === 'preload'),
      ).toBe(true),
    )
    expect(preloadedLanguageNames()).toEqual(['typescript', 'json', 'css'])
    const second = await opened(provider, 'second.html', 'html')
    expect(second.languageRegistrations).toMatchObject([{ name: 'html' }])
  })
  it('reads the preload getter when warming runs after open', async () => {
    let wanted: readonly string[] = []
    const owner = explicitOwner()
    const provider = activate({ workerOwner: owner, preloadLanguages: () => wanted })
    const { session, buffer } = borrow(provider)
    wanted = ['json']
    await session.refresh(buffer.getTextSnapshot())
    await owner.awaitIdleFence()
    await vi.waitFor(() =>
      expect(
        workers
          .flatMap((worker) => worker.requests)
          .some((request) => request.payload.type === 'preload'),
      ).toBe(true),
    )
    expect(preloadedLanguageNames()).toEqual(['typescript', 'json'])
  })
  it('answers document grammar selection without opening it', () => {
    expect(shikiLanguageForDocument({ documentId: 'App.tsx', languageId: 'typescript' }, {})).toBe(
      'tsx',
    )
    expect(
      shikiLanguageForDocument(
        { documentId: 'notes.md', languageId: 'markdown' },
        { markdown: 'mdc' },
      ),
    ).toBe('mdc')
    expect(shikiLanguageForDocument({ documentId: 'a.css', languageId: 'css' }, undefined)).toBe(
      'css',
    )
    expect(workers).toEqual([])
  })
  it('rejects an unnamed resolved theme before worker open', async () => {
    const { session, buffer } = borrow(activate({ resolveTheme: async () => ({ name: '' }) }))
    await expect(session.refresh(buffer.getTextSnapshot())).rejects.toThrow(
      'Shiki theme registrations require a non-empty name',
    )
    expect(
      workers
        .flatMap((worker) => worker.requests)
        .some((request) => request.payload.type === 'open'),
    ).toBe(false)
  })
})

function preloadedLanguageNames(): string[] {
  return workers
    .flatMap((worker) => worker.requests)
    .flatMap(({ payload }) =>
      payload.type === 'preload'
        ? (payload.languageRegistrations?.map((language) => language.name) ?? [])
        : [],
    )
}
