import { diffPieceTableSnapshots, type PieceTableSnapshot } from '@singapore-editor/core/document'
import { createTreeSitterInputEdits } from './treeSitter/edits'
import {
  DocumentDelivery,
  createEditorSnapshotBuffer,
} from '@singapore-editor/core/internal/document-worker'
import { TreeSitterWorkerClient, type TreeSitterBackend } from './treeSitter/workerClient'
import type { TreeSitterLanguageDescriptor } from './treeSitter/registry'
import type {
  TreeSitterMergeUnit,
  TreeSitterSyntaxRange,
  TreeSitterReviewBatchRequest,
} from './treeSitter/types'

export type TreeSitterReviewUnit = TreeSitterMergeUnit & {
  readonly languageId: string
  readonly hasErrors: boolean
}
export type TreeSitterReviewRead = {
  readonly snapshot: PieceTableSnapshot
  readonly ranges: readonly TreeSitterSyntaxRange[]
  readonly contentKey?: boolean
  readonly selection?: 'enclosing' | 'touching'
  readonly baseSnapshot?: PieceTableSnapshot
}
export type TreeSitterReviewSyntax = ((
  snapshot: PieceTableSnapshot,
  ranges: readonly TreeSitterSyntaxRange[],
  contentKey?: boolean,
  selection?: 'enclosing' | 'touching',
  baseSnapshot?: PieceTableSnapshot,
) => Promise<readonly (readonly TreeSitterReviewUnit[])[] | null>) & {
  batch(
    reads: readonly TreeSitterReviewRead[],
  ): Promise<readonly (readonly (readonly TreeSitterReviewUnit[])[] | null)[]>
  /** Release snapshot trees between review batches. */
  release(): Promise<void>
  dispose(): Promise<void>
}

type SnapshotEntry = {
  readonly id: string
  readonly version: number
  readonly delivery: DocumentDelivery
  readonly scope: ReturnType<DocumentDelivery['createScope']>
  readonly ready: Promise<boolean>
}

/** A demand-only worker reader for confirmed and author-projected snapshots. */
export function createTreeSitterReviewSyntax(options: {
  readonly languageId: string
  readonly languages: readonly TreeSitterLanguageDescriptor[]
  readonly backend?: TreeSitterBackend
}): TreeSitterReviewSyntax {
  const backend = options.backend ?? new TreeSitterWorkerClient()
  const snapshots = new Map<PieceTableSnapshot, SnapshotEntry>()
  const lifetime = crypto.randomUUID()
  let batch = 0
  let version = 0
  let disposed = false
  let registration: Promise<void> | undefined
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const task = tail.then(run)
    tail = task.catch(() => {})
    return task
  }
  const runtime = () => `merge-review-${lifetime}-${batch}`

  async function admit(snapshot: PieceTableSnapshot): Promise<SnapshotEntry> {
    const cached = snapshots.get(snapshot)
    if (cached) return cached
    const buffer = createEditorSnapshotBuffer(snapshot)
    const id = runtime()
    const snapshotVersion = ++version
    const delivery = new DocumentDelivery(buffer, id)
    const scope = delivery.createScope()
    const ready = (async () => {
      const loan = await scope.source.prepareReader(backend.sourceEndpoint, delivery.current()!)
      if (!loan) return false
      try {
        const identity = {
          documentId: id,
          runtimeSessionId: id,
          languageId: options.languageId,
          snapshotVersion,
          source: loan.reference,
        }
        const result = await backend.parse({ ...identity, resultMode: 'parseOnly', readOnly: true })
        const retained = (await backend.inspectRetention?.())?.documents.find(
          (document) => document.runtimeSessionId === id,
        )?.snapshots
        if (retained) {
          for (const [snapshot, entry] of snapshots) {
            if (retained.some((snapshot) => snapshot.snapshotVersion === entry.version)) continue
            snapshots.delete(snapshot)
            entry.scope.dispose()
            entry.delivery.dispose()
          }
        }
        return Boolean(result && (!('status' in result) || result.status === 'parsed'))
      } finally {
        await loan.dispose()
      }
    })()
    const entry = { id, version: snapshotVersion, delivery, scope, ready }
    snapshots.set(snapshot, entry)
    return entry
  }

  function readBatch(reads: readonly TreeSitterReviewRead[]) {
    return serial(async () => {
      if (disposed || !backend.reviewBatch) return reads.map(() => null)
      await (registration ??= backend.registerLanguages(options.languages))
      let queries: TreeSitterReviewBatchRequest['queries'][number][] = []
      let cleanup: (() => Promise<void>)[] = []
      const results: (readonly (readonly TreeSitterReviewUnit[])[] | null)[] = []
      let preparedBase: PieceTableSnapshot | undefined
      const settle = async (): Promise<void> => {
        if (!queries.length) return
        try {
          const result = await backend.reviewBatch!({ runtimeSessionId: runtime(), queries })
          for (let index = 0; index < queries.length; index++) {
            const entry = result?.results[index]
            results.push(
              !disposed && entry?.status === 'ok'
                ? entry.units.map((units) =>
                    units.map((unit) => ({ ...unit, hasErrors: unit.hasErrors ?? false })),
                  )
                : null,
            )
          }
        } finally {
          const retiring = cleanup
          cleanup = []
          queries = []
          await disposeReads(retiring)
        }
      }
      try {
        for (const read of reads) {
          const {
            snapshot,
            ranges,
            baseSnapshot,
            contentKey = false,
            selection = 'enclosing',
          } = read
          const base = baseSnapshot ?? snapshot
          // A new admission may evict any previous base under either retention limit.
          if (preparedBase && preparedBase !== base) await settle()
          preparedBase = base
          const entry = await admit(base)
          if (!(await entry.ready) || disposed) return reads.map(() => null)
          const identity = {
            documentId: entry.id,
            runtimeSessionId: entry.id,
            languageId: options.languageId,
            snapshotVersion: entry.version,
            ranges,
            selection,
            analysis: true as const,
            ...(contentKey ? { contentKey: true as const } : {}),
          }
          if (!baseSnapshot) {
            queries.push({ ...identity, type: 'mergeUnits' })
            continue
          }
          const delivery = new DocumentDelivery(createEditorSnapshotBuffer(snapshot), entry.id)
          const scope = delivery.createScope()
          let loan: Awaited<ReturnType<typeof scope.source.prepareReader>>
          cleanup.push(async () => {
            try {
              await loan?.dispose()
            } finally {
              scope.dispose()
              delivery.dispose()
            }
          })
          loan = await scope.source.prepareReader(backend.sourceEndpoint, delivery.current()!)
          if (!loan) return reads.map(() => null)
          const edit = diffPieceTableSnapshots(baseSnapshot, snapshot)
          queries.push({
            ...identity,
            type: 'projectMergeUnits',
            baseSnapshotVersion: entry.version,
            snapshotVersion: ++version,
            source: loan.reference,
            inputEdits: createTreeSitterInputEdits(
              createEditorSnapshotBuffer(baseSnapshot).getTextSnapshot(),
              edit ? [edit] : [],
            ),
          })
        }
        if (disposed) return reads.map(() => null)
        await settle()
        return results
      } finally {
        await disposeReads(cleanup)
      }
    })
  }

  const read: TreeSitterReviewSyntax = Object.assign(
    async (
      snapshot: PieceTableSnapshot,
      ranges: readonly TreeSitterSyntaxRange[],
      contentKey = false,
      selection: 'enclosing' | 'touching' = 'enclosing',
      baseSnapshot?: PieceTableSnapshot,
    ) => (await readBatch([{ snapshot, ranges, contentKey, selection, baseSnapshot }]))[0] ?? null,
    {
      batch: readBatch,
      release() {
        return serial(async () => {
          const id = runtime()
          const entries = [...snapshots.values()]
          snapshots.clear()
          batch++
          version = 0
          for (const entry of entries) entry.scope.dispose()
          backend.disposeDocument(id)
          try {
            await Promise.allSettled(entries.map((entry) => entry.ready))
            await backend.awaitRuntimeSessionIdle?.(id)
          } finally {
            for (const entry of entries) entry.delivery.dispose()
          }
        })
      },
      async dispose() {
        disposed = true
        await read.release()
        if (!options.backend) await backend.dispose?.()
      },
    },
  )
  return read
}

async function disposeReads(cleanup: readonly (() => Promise<void>)[]): Promise<void> {
  const settled = await Promise.allSettled(cleanup.map((dispose) => dispose()))
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
