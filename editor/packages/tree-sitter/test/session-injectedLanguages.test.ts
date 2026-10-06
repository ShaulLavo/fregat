import {
  createTreeDocument,
  createSourceEndpoint,
  disposeTreeDocuments,
} from './factories/document'
import { readAll } from '../../editor/test/factories/snapshotText'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { RecordingWorker } from './factories/worker'

import {
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { createTreeSitterSyntaxProvider, createTreeSitterWorkerOwner } from '../src/index.ts'
import type { TreeSitterLanguageDescriptor } from '../src/treeSitter/registry.ts'
import type { TreeSitterBackend } from '../src/treeSitter/workerClient.ts'

/**
 * The worker cannot ask for a language it was never sent, so an injection whose grammar stayed on
 * the main thread silently drops its whole layer — embedded is an injection, which is why
 * container used to lose every inline construct.
 */

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  disposeTreeDocuments()
  for (const dispose of cleanup.splice(0)) await dispose()
})

const DESCRIPTORS: Record<string, TreeSitterLanguageDescriptor> = {
  container: descriptor(
    'container',
    '((inline) @injection.content (#set! injection.language "embedded"))',
  ),
  embedded: descriptor(
    'embedded',
    '((html_tag) @injection.content (#set! injection.language "html"))',
  ),
  html: descriptor('html'),
}

describe('injected language registration', () => {
  it('registers the languages an injection query names, transitively', async () => {
    const registered: string[][] = []
    const session = createSession('container', registered)

    await session.run()

    expect(registered).toEqual([['container', 'embedded', 'html']])
  })

  it('registers only the document language when nothing is injected', async () => {
    const registered: string[][] = []
    const session = createSession('html', registered)

    await session.run()

    expect(registered).toEqual([['html']])
  })
})

function createSession(languageId: string, registered: string[][]) {
  return createTreeDocument({
    documentId: 'doc',
    languageId,
    languageResolver: {
      resolveTreeSitterLanguage: async (id) => DESCRIPTORS[id] ?? null,
    },
    backend: recordingBackend(registered),
    text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(''))),
  })
}

function recordingBackend(registered: string[][]): TreeSitterBackend {
  return {
    generation: 1,
    sourceEndpoint: createSourceEndpoint(),
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
    injectionDependencies: { container: ['embedded'], embedded: ['html'] }[id] ?? [],
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
  const session = createTreeDocument({
    documentId: 'delayed',
    languageId: 'container',
    text: readAll(createDocumentTextSnapshot(snapshot)),
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
  const refresh = session.run()
  await requestedPromise
  session.dispose()
  release(descriptor('astro'))
  await refresh
  expect(parses).toBe(1)
  expect(registered).toEqual([['container', 'embedded', 'html']])
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
  const session = createTreeDocument({
    documentId: 'delayed',
    languageId: 'container',
    text: readAll(createDocumentTextSnapshot(snapshot)),
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
  const first = session.run()
  await requestedPromise
  const second = session.edit([{ from: 0, to: 0, text: 'x' }])
  release(descriptor('astro'))
  const [, latest] = await Promise.all([first, second])
  expect(loads).toBe(1)
  expect(session.runtime.getResult()).toBe(latest)
  expect(latest.projection.snapshot.length).toBe(session.buffer.getTextSnapshot().length)
  expect(registered).toEqual([['container', 'embedded', 'html'], ['astro']])
  session.dispose()
})

describe('provider warm-up', () => {
  it('warms the host languages with their injection closures after a first parse', async () => {
    const warm = warmingProvider(() => ['container', 'html', 'unknown'])

    expect(warm.warmed).toEqual([])
    await warm.openDocument('html')
    await flushPromises()

    expect(warm.warmed).toEqual([['container', 'embedded', 'html']])
  })

  it('reads the host set again for each new document and skips an unchanged one', async () => {
    let languages = ['html']
    const warm = warmingProvider(() => languages)

    await warm.openDocument('html')
    await warm.openDocument('html')
    languages = ['container']
    await warm.openDocument('html')
    await flushPromises()

    expect(warm.warmed).toEqual([['html'], ['container', 'embedded']])
  })

  it('warms replaced registrations even when the host language list is unchanged', async () => {
    const warmedUrls: string[][] = []
    const warm = warmingProvider(
      () => ['html'],
      async (languages) => {
        warmedUrls.push(languages.map((language) => language.wasmUrl))
      },
    )
    await warm.openDocument('html')
    await flushPromises()
    const replacement = warm.provider.registerLanguage(
      { ...descriptor('html'), wasmUrl: '/replacement.wasm' },
      { replace: true },
    )
    await warm.openDocument('html')
    await flushPromises()
    replacement.dispose()
    await warm.openDocument('html')
    await flushPromises()

    expect(warmedUrls).toEqual([
      [descriptor('html').wasmUrl],
      ['/replacement.wasm'],
      [descriptor('html').wasmUrl],
    ])
  })

  it('skips a grammar that fails to load and survives a worker that cannot start', async () => {
    const warm = warmingProvider(() => ['broken', 'html'])
    warm.provider.registerLanguage({
      id: 'broken',
      load: () => Promise.reject(new Error('offline')),
    })

    await warm.openDocument('html')
    await flushPromises()
    expect(warm.warmed).toEqual([['html']])

    const failing = warmingProvider(
      () => ['html'],
      () => Promise.reject(new Error('down')),
    )
    await failing.openDocument('html')
    await flushPromises()
  })
})

function warmingProvider(
  languages: () => readonly string[],
  warmLanguages?: TreeSitterBackend['warmLanguages'],
) {
  const warmed: string[][] = []
  const owner = createTreeSitterWorkerOwner({
    workerFactory: () =>
      new RecordingWorker(
        warmLanguages ??
          (async (descriptors) => {
            warmed.push(descriptors.map((language) => language.id))
          }),
      ),
  })
  cleanup.push(() => owner.dispose())
  const provider = createTreeSitterSyntaxProvider({ workerOwner: owner, warmLanguages: languages })
  for (const language of Object.values(DESCRIPTORS)) provider.registerLanguage(language)
  const openDocument = async (languageId: string) => {
    const buffer = createEditorTextBuffer('<p>hi</p>')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: `doc-${languageId}` })
    const lease = analysis.borrowStructural({ provider, languageId })!
    try {
      await lease.refresh(buffer.getTextSnapshot())
    } finally {
      lease.dispose()
      analysis.dispose()
    }
  }
  return { openDocument, provider, warmed }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
