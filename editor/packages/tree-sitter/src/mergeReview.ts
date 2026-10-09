import { diffPieceTableSnapshots, type PieceTableSnapshot } from '@singapore-editor/core/document'
import { createTreeSitterInputEdits } from './treeSitter/edits'
import {
  DocumentDelivery,
  createEditorSnapshotBuffer,
} from '@singapore-editor/core/internal/document-worker'
import { TreeSitterWorkerClient, type TreeSitterBackend } from './treeSitter/workerClient'
import type { TreeSitterLanguageDescriptor } from './treeSitter/registry'
import type { TreeSitterMergeUnit, TreeSitterSyntaxRange } from './treeSitter/types'

export type TreeSitterReviewUnit = TreeSitterMergeUnit & {
  readonly languageId: string
  readonly hasErrors: boolean
}
export type TreeSitterReviewSyntax = ((
  snapshot: PieceTableSnapshot,
  ranges: readonly TreeSitterSyntaxRange[],
  contentKey?: boolean,
  selection?: 'enclosing' | 'touching',
  baseSnapshot?: PieceTableSnapshot,
) => Promise<readonly (readonly TreeSitterReviewUnit[])[] | null>) & {
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
        const result = await backend.parse({ ...identity, resultMode: 'parseOnly' })
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

  async function project(
    snapshot: PieceTableSnapshot,
    baseSnapshot: PieceTableSnapshot,
    ranges: readonly TreeSitterSyntaxRange[],
    contentKey: boolean,
    selection: 'enclosing' | 'touching',
  ): Promise<readonly (readonly TreeSitterReviewUnit[])[] | null> {
    if (!backend.projectMergeUnits) return null
    const base = await admit(baseSnapshot)
    if (!(await base.ready) || disposed) return null
    const delivery = new DocumentDelivery(createEditorSnapshotBuffer(snapshot), base.id)
    const scope = delivery.createScope()
    try {
      const loan = await scope.source.prepareReader(backend.sourceEndpoint, delivery.current()!)
      if (!loan) return null
      try {
        if (disposed) return null
        const edit = diffPieceTableSnapshots(baseSnapshot, snapshot)
        const result = await backend.projectMergeUnits({
          documentId: base.id,
          runtimeSessionId: base.id,
          languageId: options.languageId,
          baseSnapshotVersion: base.version,
          snapshotVersion: ++version,
          source: loan.reference,
          inputEdits: createTreeSitterInputEdits(
            createEditorSnapshotBuffer(baseSnapshot).getTextSnapshot(),
            edit ? [edit] : [],
          ),
          ranges,
          selection,
          analysis: true,
          ...(contentKey ? { contentKey: true as const } : {}),
        })
        if (!result || result.status !== 'ok' || disposed) return null
        return result.units.map((units) =>
          units.map((unit) => ({ ...unit, hasErrors: unit.hasErrors ?? false })),
        )
      } finally {
        await loan.dispose()
      }
    } finally {
      scope.dispose()
      delivery.dispose()
    }
  }

  const read: TreeSitterReviewSyntax = Object.assign(
    async (
      snapshot: PieceTableSnapshot,
      ranges: readonly TreeSitterSyntaxRange[],
      contentKey = false,
      selection: 'enclosing' | 'touching' = 'enclosing',
      baseSnapshot?: PieceTableSnapshot,
    ) =>
      serial(async () => {
        if (disposed || !backend.mergeUnit) return null
        await (registration ??= backend.registerLanguages(options.languages))
        if (disposed) return null
        if (baseSnapshot) return project(snapshot, baseSnapshot, ranges, contentKey, selection)
        const entry = await admit(snapshot)
        if (!(await entry.ready) || disposed) return null
        const result: (readonly TreeSitterReviewUnit[])[] = []
        for (const range of ranges) {
          if (disposed) return null
          const units = await backend.mergeUnit({
            documentId: entry.id,
            runtimeSessionId: entry.id,
            languageId: options.languageId,
            snapshotVersion: entry.version,
            range,
            selection,
            analysis: true,
            ...(contentKey ? { contentKey: true as const } : {}),
          })
          if (!units || units.status !== 'ok') return null
          result.push(
            (units.units ?? [units.unit]).map((unit) => ({
              ...unit,
              languageId: units.languageId,
              hasErrors: unit.hasErrors ?? false,
            })),
          )
        }
        return result
      }),
    {
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
