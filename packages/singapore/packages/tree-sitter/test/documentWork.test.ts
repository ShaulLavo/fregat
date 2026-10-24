import { expect, it } from 'vitest'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  acquireEditorDocumentAnalysis,
  defineDocumentOperation,
  DocumentWorkerReader,
  waitForDocumentWork,
  type DocumentSourceConnection,
} from '@singapore-editor/core/internal/document-worker'
import { TreeSitterSyntaxSession } from '../src/session'
import type { TreeSitterBackend } from '../src/treeSitter/workerClient'

it('can restore the same accepted read after a canceled epoch restoration', async () => {
  let generation = 1
  let reader = new DocumentWorkerReader()
  let connection = connect(reader, generation)
  let hold: Promise<void> | null = null
  let started = () => {}
  let parses = 0
  const backend: TreeSitterBackend = {
    get generation() {
      return generation
    },
    sourceEndpoint: { connect: async () => connection },
    registerLanguages: async () => {},
    disposeDocument: () => {},
    select: async () => undefined,
    edit: async () => undefined,
    parse: async (payload, signal) => {
      parses++
      started()
      if (hold) await waitForDocumentWork(hold, signal)
      const loan = reader.acquire(payload.source)
      if (!loan) throw new TypeError('The admitted source must be readable')
      loan.dispose()
      return {
        documentId: payload.documentId,
        languageId: payload.languageId,
        snapshotVersion: payload.snapshotVersion,
        captures: [],
        folds: [],
        brackets: [],
        errors: [],
        injections: [],
        timings: [],
      }
    },
    queryRange: async (payload) => ({
      documentId: payload.documentId,
      languageId: payload.languageId,
      snapshotVersion: payload.snapshotVersion,
      range: payload.range,
      folds: [],
      brackets: [],
      errors: [],
      injections: [],
      timings: [],
      captures: [
        {
          captureName: 'variable',
          startIndex: 6,
          endIndex: 15,
          startPosition: { row: 0, column: 6 },
          endPosition: { row: 0, column: 15 },
        },
      ],
    }),
  }
  const buffer = createEditorTextBuffer('const recovered = 1;')
  const owned = acquireEditorDocumentAnalysis({ buffer, documentId: 'restore-cancel.ts' })
  const runtimes: TreeSitterSyntaxSession[] = []
  const operation = defineDocumentOperation(
    (context) => {
      const runtime = new TreeSitterSyntaxSession({ ...context, languageId: 'typescript', backend })
      runtimes.push(runtime)
      return runtime
    },
    () => true,
  )
  const lease = owned.analysis.contributions.retain(operation, null)!
  const range = { startIndex: 6, endIndex: 15 }
  try {
    await lease.request()
    const runtime = runtimes[0]!
    expect((await runtime.queryRange(range)).captures).toHaveLength(1)
    reader.dispose()
    reader = new DocumentWorkerReader()
    generation = 2
    connection = connect(reader, generation)
    hold = new Promise(() => {})
    const parsing = new Promise<void>((resolve) => {
      started = resolve
    })
    const work = new AbortController()
    const restored = expect(runtime.queryRange(range, work.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await parsing
    work.abort()
    await restored
    hold = null
    expect((await runtime.queryRange(range)).captures).toHaveLength(1)
    expect(runtime.canQueryRange()).toBe(true)
    expect(parses).toBe(3)
    expect(buffer.getRevision()).toBe(0)
  } finally {
    lease.dispose()
    owned.dispose()
    reader.dispose()
  }
})

function connect(reader: DocumentWorkerReader, generation: number): DocumentSourceConnection {
  let registration = 0
  return {
    generation,
    nextRegistration: () => ++registration,
    send: async (command) => reader.apply(command),
    release: (identity) => {
      reader.apply({ kind: 'release', identity })
    },
  }
}
