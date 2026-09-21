import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  deleteStoredHistory,
  pruneStoredHistories,
  readStoredHistory,
  writeStoredHistory,
} from '@/features/editor/state/history-store'
import type { LiveEditorDocument } from '@/features/editor/state/workspace-document-service'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import { log } from '@/lib/client-logging'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { runMutation } from '@/lib/mutations/run'
import { readSettingBootValue } from '@/lib/settings-boot-mirror'
import type { EditorTextBuffer, SerializedEditorHistory } from '@singapore-editor/core/document'
import {
  mutationOptions,
  queryOptions,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'

const DAY_MS = 86_400_000

type FileDocument = LiveEditorDocument & {
  readonly sync: Extract<LiveEditorDocument['sync'], { readonly kind: 'file' }>
}

type LiveDocuments = Readonly<Record<DocumentKey, LiveEditorDocument>>

/**
 * Keeps a closed file's undo history in IndexedDB. A history is stored whenever the
 * buffer is known to equal the file (a save landed, or a clean document was evicted)
 * and handed back to a fresh buffer only while the file's content hash still matches.
 */
export class HistoryPersistenceService {
  // A buffer whose restore has not settled yet has no history to speak of, and must
  // not be read as "the user cleared it".
  private readonly settledBuffers = new WeakSet<EditorTextBuffer>()
  // Buffers with a record behind them; only these have anything to delete.
  private readonly storedBuffers = new WeakSet<EditorTextBuffer>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly documentStore: EditorDocumentStoreApi,
    private readonly queryClient: QueryClient,
    /** Paths repeat across environments, so the environment is part of the identity. */
    private readonly environmentId: string,
  ) {
    this.unsubscribe = documentStore.subscribe(
      (state) => state.liveDocumentsByKey,
      (documents, previous) => this.reconcile(documents, previous),
    )
    this.reconcile(documentStore.getState().liveDocumentsByKey, {})
    if (persistenceEnabled()) void this.run(this.pruneOptions(), undefined)
  }

  dispose() {
    this.unsubscribe()
  }

  private reconcile(documents: LiveDocuments, previous: LiveDocuments) {
    const liveBuffers = new Set(Object.values(documents).map((document) => document.buffer))
    for (const document of Object.values(previous)) {
      if (documents[document.key] || liveBuffers.has(document.buffer)) continue
      if (isFileDocument(document)) this.persist(document)
    }

    for (const document of Object.values(documents)) {
      if (!isFileDocument(document)) continue
      const before = previous[document.key]
      if (before?.buffer !== document.buffer) {
        void this.restore(document)
        continue
      }
      if (before.sync.kind === 'file' && before.sync.fileVersion !== document.sync.fileVersion) {
        this.persist(document)
      }
    }
  }

  private persist(document: FileDocument) {
    if (!persistenceEnabled()) return
    // Dirty text is not the text the hash names; the next save stores it instead.
    if (document.buffer.isDirty()) return
    if (!this.settledBuffers.has(document.buffer)) return

    const history = document.buffer.serializeHistory()
    if (!history && !this.storedBuffers.has(document.buffer)) return
    if (history) this.storedBuffers.add(document.buffer)
    void this.run(this.persistOptions(document.key), {
      contentHash: document.sync.fileVersion,
      history,
    })
  }

  private async restore(document: FileDocument) {
    const { buffer, key } = document
    if (!persistenceEnabled()) {
      this.settledBuffers.add(buffer)
      return
    }

    const startedAt = performance.now()
    try {
      const stored = await this.queryClient.fetchQuery(this.storedHistoryOptions(key))
      if (!stored) return

      const outcome = this.adopt(document, stored.contentHash, stored.data)
      if (outcome === 'stale') await this.run(this.forgetOptions(key), undefined)
      log.info({
        action: 'editor.history.restore',
        area: 'editor',
        durationMs: Math.round(performance.now() - startedAt),
        outcome,
        path: key,
        storedSize: stored.data.length,
      })
    } catch (error) {
      log.warn({ action: 'editor.history.restore_failed', area: 'editor', error, path: key })
    } finally {
      this.settledBuffers.add(buffer)
    }
  }

  private adopt(document: FileDocument, contentHash: string, data: string) {
    const live = this.documentStore.getState().liveDocumentsByKey[document.key]
    if (live?.buffer !== document.buffer || live.sync.kind !== 'file') return 'superseded'
    if (live.sync.fileVersion !== contentHash) return 'stale'
    if (document.buffer.isDirty()) return 'superseded'

    const history = JSON.parse(data) as SerializedEditorHistory
    if (!document.buffer.restoreHistory(history)) return 'rejected'

    this.storedBuffers.add(document.buffer)
    return 'restored'
  }

  private async run<TVariables>(
    options: MutationOptions<void, Error, TVariables>,
    variables: TVariables,
  ) {
    try {
      await runMutation(this.queryClient, options, variables)
    } catch {
      // Reported by the mutation's onError; undo persistence never interrupts editing.
    }
  }

  private storedHistoryOptions(key: DocumentKey) {
    const id = this.storageId(key)
    return queryOptions({
      // Read once per open and never reused: the history can be megabytes.
      gcTime: 0,
      queryFn: () => readStoredHistory(id),
      queryKey: editorQueryKeys.storedHistory(id),
      staleTime: 0,
    })
  }

  private persistOptions(key: DocumentKey) {
    const id = this.storageId(key)
    return mutationOptions({
      mutationFn: async (input: {
        readonly contentHash: string
        readonly history: SerializedEditorHistory | null
      }) => {
        // Nothing left to undo is also a fact worth storing: the user cleared it.
        if (!input.history) {
          await deleteStoredHistory(id)
          return
        }

        const data = JSON.stringify(input.history)
        const stored = await writeStoredHistory(
          id,
          { contentHash: input.contentHash, data },
          { budget: readSettingBootValue('editor.history.persistBudget'), now: Date.now() },
        )
        log.debug({
          action: 'editor.history.persist',
          area: 'editor',
          path: key,
          states: input.history.nodes.length,
          stored,
          storedSize: data.length,
        })
      },
      mutationKey: editorMutationKeys.historyPersist(key),
      onError: (error) => reportFailure('persist', key, error),
      // Saves of one file land in order, so the newest history is the one that stays.
      scope: { id: `editor-history-store:${id}` },
    })
  }

  private forgetOptions(key: DocumentKey) {
    const id = this.storageId(key)
    return mutationOptions({
      mutationFn: () => deleteStoredHistory(id),
      mutationKey: editorMutationKeys.historyForget(key),
      onError: (error) => reportFailure('forget', key, error),
      scope: { id: `editor-history-store:${id}` },
    })
  }

  private pruneOptions() {
    return mutationOptions({
      mutationFn: async () => {
        const removed = await pruneStoredHistories({
          budget: readSettingBootValue('editor.history.persistBudget'),
          expiredBefore: Date.now() - readSettingBootValue('editor.history.persistDays') * DAY_MS,
        })
        log.info({ action: 'editor.history.prune', area: 'editor', removed })
      },
      mutationKey: editorMutationKeys.historyPrune(),
      onError: (error) => reportFailure('prune', null, error),
    })
  }

  private storageId(key: DocumentKey) {
    return `${this.environmentId}\n${key}`
  }
}

function persistenceEnabled() {
  return readSettingBootValue('editor.history.persist')
}

function isFileDocument(document: LiveEditorDocument): document is FileDocument {
  return document.sync.kind === 'file'
}

function reportFailure(operation: string, key: DocumentKey | null, error: unknown) {
  log.warn({ action: 'editor.history.store_failed', area: 'editor', error, operation, path: key })
}
