import { expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  acquireEditorDocumentAnalysis,
  defineDocumentOperation,
} from '@singapore-editor/core/internal/document-worker'
import { TYPESCRIPT_TREE_SITTER_LANGUAGE } from '../../tree-sitter-languages/src/index'
import { resolveTreeSitterLanguageContribution } from '../src/treeSitter/registry'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import type { TreeSitterWorkerRequest } from '../src/treeSitter/types'
import { createTreeSitterSyntaxProvider, createTreeSitterWorkerOwner } from '../src/index'

it.each([true, false])(
  'queries accepted source after a real worker restart, range cached=%s',
  async (cached) => {
    const workers: Worker[] = []
    const owner = createTreeSitterWorkerOwner({
      workerFactory: () => {
        const worker = new Worker(
          new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url),
          { type: 'module' },
        )
        workers.push(worker)
        return worker
      },
    })
    const provider = createTreeSitterSyntaxProvider({ workerOwner: owner })
    provider.registerLanguage(TYPESCRIPT_TREE_SITTER_LANGUAGE)
    const buffer = createEditorTextBuffer('const recovered = 1;')
    const owned = acquireEditorDocumentAnalysis({ buffer, documentId: 'restart.ts' })
    const lease = owned.analysis.borrowStructural({
      provider,
      languageId: 'typescript',
      includeCaptures: true,
      syntaxMode: 'range',
    })!
    const range = { startIndex: 0, endIndex: cached ? buffer.getTextSnapshot().length : 6 }
    try {
      await lease.refresh(buffer.getTextSnapshot())
      const initial = await lease.queryRange(range)
      expect(initial.captures.length).toBeGreaterThan(0)
      workers[0]!.dispatchEvent(
        new ErrorEvent('error', { message: 'Controlled parser worker restart' }),
      )
      expect(owner.inspect().lifecycle).toBe('crashed')
      const recovered = await lease.queryRange({ startIndex: 6, endIndex: 15 })
      expect(
        recovered.captures.some((capture) => capture.startIndex === 6 && capture.endIndex === 15),
      ).toBe(true)
      expect(workers).toHaveLength(cached ? 1 : 2)
      expect(owner.inspect().workerGeneration).toBe(cached ? 1 : 2)
      if (cached) expect(await owner.inspectRetention()).toBeNull()
      else expect((await owner.inspectRetention())?.source.documentCount).toBe(1)
    } finally {
      lease.dispose()
      owned.dispose()
      await owner.dispose()
    }
  },
)

it('aborts the posted parser waiter and parses newest source on the same real worker', async () => {
  const worker = new Worker(new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url), {
    type: 'module',
  })
  let posted = () => {}
  const firstPosted = new Promise<void>((resolve) => {
    posted = resolve
  })
  const requests: TreeSitterWorkerRequest[] = []
  const post = worker.postMessage.bind(worker)
  vi.spyOn(worker, 'postMessage').mockImplementation((request: TreeSitterWorkerRequest) => {
    requests.push(request)
    post(request)
    if (request.payload.type === 'parse') posted()
  })
  const backend = new TreeSitterWorkerClient({ workerFactory: () => worker })
  await backend.registerLanguages([
    await resolveTreeSitterLanguageContribution(TYPESCRIPT_TREE_SITTER_LANGUAGE),
  ])
  const buffer = createEditorTextBuffer('const old = 1;')
  const view = createEditorBufferSession(buffer)
  const owned = acquireEditorDocumentAnalysis({ buffer, documentId: 'cancel.ts' })
  const operation = defineDocumentOperation(
    (context) => ({
      analyze: async (read, signal) => {
        const loan = await context.source.prepareReader(backend.sourceEndpoint, read, signal)
        if (!loan) throw new DOMException('Reader unavailable', 'AbortError')
        try {
          return await backend.parse(
            {
              documentId: context.documentId,
              runtimeSessionId: context.runtimeSessionId,
              snapshotVersion: read.revision.point.revision + 1,
              languageId: 'typescript',
              includeCaptures: true,
              source: loan.reference,
            },
            signal,
          )
        } finally {
          await loan.dispose()
        }
      },
      dispose: () => {},
    }),
    () => true,
  )
  const lease = owned.analysis.contributions.retain(operation, null)!
  const obsolete = expect(lease.request()).rejects.toMatchObject({ name: 'AbortError' })
  try {
    await firstPosted
    view.applyEdits([{ from: 6, to: 9, text: 'newest' }])
    const first = requests.find((request) => request.payload.type === 'parse')
    if (first?.payload.type === 'parse' && first.payload.cancellationBuffer)
      expect(Atomics.load(new Int32Array(first.payload.cancellationBuffer), 0)).toBe(1)
    const latest = await lease.request()
    await obsolete
    expect(latest?.snapshotVersion).toBe(2)
    expect(latest?.captures.length).toBeGreaterThan(0)
    const text = buffer.getTextSnapshot().readRange(0, buffer.getTextSnapshot().length)
    expect(
      latest?.captures.some(
        (capture) => text.slice(capture.startIndex, capture.endIndex) === 'newest',
      ),
    ).toBe(true)
    const parses = requests.filter((request) => request.payload.type === 'parse')
    expect(parses).toHaveLength(2)
    expect(parses[0]?.payload).toMatchObject({ runtimeSessionId: lease.runtimeSessionId })
    expect(parses[1]?.payload).toMatchObject({ runtimeSessionId: lease.runtimeSessionId })
    await backend.awaitIdleFence()
    expect(backend.inspect().pendingRequests).toBe(0)
  } finally {
    lease.dispose()
    owned.dispose()
    await backend.dispose()
    vi.restoreAllMocks()
  }
})
