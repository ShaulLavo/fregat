import { describe, expect, it } from 'vitest'

import {
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { createTreeSitterSyntaxProvider } from '../src/index.ts'
import { TreeSitterSyntaxSession } from '../src/session.ts'
import type { TreeSitterLanguageDescriptor } from '../src/treeSitter/registry.ts'
import type { TreeSitterBackend } from '../src/treeSitter/workerClient.ts'

/**
 * The worker cannot ask for a language it was never sent, so an injection whose grammar stayed on
 * the main thread silently drops its whole layer — markdown_inline is an injection, which is why
 * markdown used to lose every inline construct.
 */

const DESCRIPTORS: Record<string, TreeSitterLanguageDescriptor> = {
  markdown: descriptor(
    'markdown',
    '((inline) @injection.content (#set! injection.language "markdown_inline"))',
  ),
  markdown_inline: descriptor(
    'markdown_inline',
    '((html_tag) @injection.content (#set! injection.language "html"))',
  ),
  html: descriptor('html'),
}

describe('injected language registration', () => {
  it('registers the languages an injection query names, transitively', async () => {
    const registered: string[][] = []
    const session = createSession('markdown', registered)

    await session.refresh(createDocumentTextSnapshot(createPieceTableSnapshot('# Title\n')))

    expect(registered).toEqual([['markdown', 'markdown_inline', 'html']])
  })

  it('registers only the document language when nothing is injected', async () => {
    const registered: string[][] = []
    const session = createSession('html', registered)

    await session.refresh(createDocumentTextSnapshot(createPieceTableSnapshot('<p>hi</p>')))

    expect(registered).toEqual([['html']])
  })
})

function createSession(languageId: string, registered: string[][]): TreeSitterSyntaxSession {
  return new TreeSitterSyntaxSession({
    documentId: 'doc',
    languageId,
    languageResolver: {
      resolveTreeSitterLanguage: async (id) => DESCRIPTORS[id] ?? null,
    },
    backend: recordingBackend(registered),
    snapshot: createPieceTableSnapshot(''),
    textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot('')),
  })
}

function recordingBackend(registered: string[][]): TreeSitterBackend {
  return {
    registerLanguages: async (languages) => {
      registered.push(languages.map((language) => language.id))
    },
    parse: async () => undefined,
    edit: async () => undefined,
    select: async () => undefined,
    disposeDocument: () => undefined,
  }
}

function descriptor(id: string, injectionQuerySource?: string): TreeSitterLanguageDescriptor {
  return {
    id,
    aliases: [id],
    injectionDependencies: { markdown: ['markdown_inline'], markdown_inline: ['html'] }[id] ?? [],
    extensions: [],
    wasmUrl: `${id}.wasm`,
    ...(injectionQuerySource ? { injectionQuerySource } : {}),
  }
}

it('does not register or parse a delayed injection after disposal', async () => {
  let release!: (descriptor: TreeSitterLanguageDescriptor) => void
  let requested!: () => void
  const requestedPromise = new Promise<void>((resolve) => {
    requested = resolve
  })
  const delayed = new Promise<TreeSitterLanguageDescriptor>((resolve) => {
    release = resolve
  })
  const registered: string[][] = []
  let parses = 0
  const backend: TreeSitterBackend = {
    ...recordingBackend(registered),
    parse: async (payload) => {
      parses += 1
      return {
        documentId: payload.documentId,
        languageId: payload.languageId,
        snapshotVersion: payload.snapshotVersion,
        status: 'parsed',
        changedRanges: [],
        missingLanguages: ['astro', 'astro'],
        timings: [],
      }
    },
  }
  const snapshot = createPieceTableSnapshot('```astro\n<Card />\n```')
  const session = new TreeSitterSyntaxSession({
    documentId: 'delayed',
    languageId: 'markdown',
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot),
    backend,
    syntaxMode: 'range',
    languageResolver: {
      resolveTreeSitterLanguage: async (id) => {
        if (id !== 'astro') return descriptor(id)
        requested()
        return delayed
      },
    },
  })
  const refresh = session.refresh(createDocumentTextSnapshot(snapshot))
  await requestedPromise
  session.dispose()
  release(descriptor('astro'))
  await refresh
  expect(parses).toBe(1)
  expect(registered).toEqual([['markdown', 'markdown_inline', 'html']])
})

it('shares a delayed language load with the newer document version', async () => {
  let release!: (descriptor: TreeSitterLanguageDescriptor) => void
  let requested!: () => void
  const requestedPromise = new Promise<void>((resolve) => {
    requested = resolve
  })
  const delayed = new Promise<TreeSitterLanguageDescriptor>((resolve) => {
    release = resolve
  })
  const registered: string[][] = []
  let loads = 0
  const backend: TreeSitterBackend = {
    ...recordingBackend(registered),
    parse: async (payload) => ({
      documentId: payload.documentId,
      languageId: payload.languageId,
      snapshotVersion: payload.snapshotVersion,
      status: 'parsed',
      changedRanges: [],
      missingLanguages: registered.some((ids) => ids.includes('astro')) ? [] : ['astro'],
      timings: [],
    }),
  }
  const snapshot = createPieceTableSnapshot('```astro\n<Card />\n```')
  const session = new TreeSitterSyntaxSession({
    documentId: 'delayed',
    languageId: 'markdown',
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot),
    backend,
    syntaxMode: 'range',
    languageResolver: {
      resolveTreeSitterLanguage: async (id) => {
        if (id !== 'astro') return descriptor(id)
        loads += 1
        requested()
        return delayed
      },
    },
  })
  const first = session.refresh(createDocumentTextSnapshot(snapshot))
  await requestedPromise
  const second = session.refresh(
    createDocumentTextSnapshot(createPieceTableSnapshot('```astro\n<NewCard />\n```')),
  )
  release(descriptor('astro'))
  await Promise.all([first, second])
  expect(loads).toBe(1)
  expect(session.getResult().projection.snapshot.version).toBe(2)
  expect(registered).toEqual([['markdown', 'markdown_inline', 'html'], ['astro']])
  session.dispose()
})

describe('provider warm-up', () => {
  it('warms each language with its injection closure, once per id', async () => {
    const warmed: string[][] = []
    const provider = createTreeSitterSyntaxProvider({
      backend: {
        ...recordingBackend([]),
        warmLanguages: async (languages) => {
          warmed.push(languages.map((language) => language.id))
        },
      },
    })
    for (const language of Object.values(DESCRIPTORS)) provider.registerLanguage(language)

    await provider.warmLanguages(['markdown', 'html', 'unknown'])

    expect(warmed).toEqual([['markdown', 'markdown_inline', 'html']])
  })

  it('skips a language whose grammar fails to load', async () => {
    const warmed: string[][] = []
    const provider = createTreeSitterSyntaxProvider({
      backend: {
        ...recordingBackend([]),
        warmLanguages: async (languages) => {
          warmed.push(languages.map((language) => language.id))
        },
      },
    })
    provider.registerLanguage(DESCRIPTORS.html!)
    provider.registerLanguage({
      id: 'broken',
      load: () => Promise.reject(new Error('offline')),
    })

    await provider.warmLanguages(['broken', 'html'])

    expect(warmed).toEqual([['html']])
  })
})

it('warm-up never rejects when the worker cannot start', async () => {
  const provider = createTreeSitterSyntaxProvider({
    backend: {
      ...recordingBackend([]),
      warmLanguages: () => Promise.reject(new Error('worker failed')),
    },
  })
  provider.registerLanguage(DESCRIPTORS.html!)

  await expect(provider.warmLanguages(['html'])).resolves.toBeUndefined()
})
