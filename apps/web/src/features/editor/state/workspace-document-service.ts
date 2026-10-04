import { isPdfFile } from '@/lib/pdf-viewer/format'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'
import {
  materializeFileSnapshotDocumentText,
  materializeFileSnapshotText,
} from '@/lib/file-snapshot'
import { scrollPositionsEqual } from '@/lib/scroll-positions'
import { markEditorOpenBenchmark } from '@/lib/editor-open-benchmark-mark'
import { createHistoryBuffer } from '@/features/editor/state/history-buffer'
import { createBinaryFileError, createClientInvariantError } from '@/lib/structured-errors'

import { contentRevisionForText, fileContentRevision } from '@/features/editor/utils/text-snapshot'
import { textSnapshotEqualsText } from '@/lib/text-snapshot-equality'
import type { PreparedFileOpenClaim } from '@/lib/file-open-intent/types'
import type {
  FileOpenIntentPreparationSource,
  FileOpenIntentPreparationSourceInput,
} from '@/lib/file-open-intent/state/service'
import { documentKey, fileDocument, fileDocumentKey } from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import { tabDocuments } from '@/lib/documents/utils/tabs'
import type {
  DocumentKey,
  DocumentRef,
  FilesystemPath,
  ReopenScrollPosition,
  EditorViewScrollPosition,
  SettingsDocumentRef,
  TabId,
  UnsyncedDocumentRef,
} from '@/lib/documents/utils/types'

import type {
  SnapshotComparisonInput,
  SnapshotComparisonLease,
  SnapshotComparisonRead,
  SnapshotComparisonRequest,
  SnapshotComparisonRefresh,
} from '@/lib/snapshot-comparison'
import type { FileSnapshot } from '@/lib/file-snapshot'
import type { EnvironmentId } from '@workspace/contracts'
import type {
  SavedComparisonLease,
  SavedComparisonRead,
  SavedComparisonRequest,
  SavedComparisonScope,
  SavedComparisonRefresh,
} from '@/features/editor/utils/saved-comparison'
import {
  createEditorViewSession,
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  type DocumentMutationLease,
  type EditorTextBuffer,
  type EditorTextBufferChange,
  type EditorViewSession,
  type PieceTableSnapshot,
  type DocumentTextSnapshot,
} from '@singapore-editor/core/document'
import {
  createEditorDocumentAnalysis,
  type EditorDocumentAnalysis,
  type EditorScrollPosition,
  type EditorPreparedDocument,
} from '@singapore-editor/core/editor'

type LiveDocumentSyncState = 'idle' | 'saving' | 'conflict'

type SettingsDocumentSync =
  | {
      kind: 'settings'
      revision: string
      state: Exclude<LiveDocumentSyncState, 'conflict'>
    }
  | {
      confirmedText: string | null
      kind: 'settings'
      revision: string | null
      state: 'conflict'
    }

type LiveDocumentSync =
  | {
      fileVersion: string
      kind: 'file'
      orphaned: boolean
      mtimeMs: number
      state: LiveDocumentSyncState
    }
  | SettingsDocumentSync
  | {
      affectedPaths: readonly FilesystemPath[]
      kind: 'recovery-conflict'
      operationId: string
    }
  | {
      kind: 'none'
    }

export type LiveEditorDocument = {
  readonly analysis: EditorDocumentAnalysis
  readonly buffer: EditorTextBuffer
  readonly contentRevision: string
  readonly key: DocumentKey
  readonly localRevision: number
  readonly target: DocumentRef
  readonly sync: LiveDocumentSync
}

export type EditorDocumentView = {
  readonly reopenScrollPosition?: EditorScrollPosition
  readonly documentKey: DocumentKey
  readonly preparedDocument: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly tabId: TabId
  readonly view: EditorViewSession
}

export type LiveEditorViewDocument = LiveEditorDocument & {
  readonly preparedDocument: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly tabId: TabId
  readonly view: EditorViewSession
}

export type WorkspaceDocumentTargetStamp = {
  readonly buffer: EditorTextBuffer
  readonly bufferRevision: number
  readonly contentRevision: string
  readonly dirty: boolean
  readonly documentKey: DocumentKey
  readonly localRevision: number
  readonly path: FilesystemPath
  readonly snapshot: PieceTableSnapshot
  readonly sync: LiveEditorDocument['sync']
}

export type WorkspaceDocumentRenameProjection = {
  readonly from: FilesystemPath
  readonly kind: 'rename'
  readonly reservation: WorkspaceDocumentPathReservation | null
  readonly source: WorkspaceDocumentTargetStamp | null
  readonly to: FilesystemPath
}

export type WorkspaceDocumentDeleteProjection = {
  readonly contentRevision: string | undefined
  readonly dirty: boolean
  readonly document: LiveEditorDocument
  readonly kind: 'delete'
  readonly reservation: WorkspaceDocumentPathReservation | null
  readonly stamp: WorkspaceDocumentTargetStamp
  readonly views: readonly EditorDocumentView[]
}

export type WorkspaceDocumentProjection =
  | WorkspaceDocumentDeleteProjection
  | WorkspaceDocumentRenameProjection

declare const workspaceDocumentPathReservationBrand: unique symbol

export type WorkspaceDocumentPathReservation = {
  readonly [workspaceDocumentPathReservationBrand]: true
  readonly ownerId: string
}

export type WorkspaceDocumentPathReservationRequest = {
  readonly canonicalPath: FilesystemPath
  readonly expectedDocumentKey: DocumentKey | null
  readonly expectedPathOwnershipRevision: number
}

export type WorkspaceDocumentPathReservationResult =
  | { readonly reservation: WorkspaceDocumentPathReservation; readonly status: 'acquired' }
  | { readonly status: 'busy' | 'stale' }

export type ReleaseWorkspaceDocumentPathReservationResult = {
  readonly status: 'already-released' | 'released'
}

type WorkspaceDocumentMutationLeaseEntry = {
  readonly buffer: EditorTextBuffer
  readonly lease: DocumentMutationLease
  readonly path: FilesystemPath
}

export type WorkspaceDocumentMutationLeaseSet = {
  readonly entries: readonly WorkspaceDocumentMutationLeaseEntry[]
  readonly ownerId: string
}

export type WorkspaceDocumentMutationLeaseResult =
  | { readonly leaseSet: WorkspaceDocumentMutationLeaseSet; readonly status: 'acquired' }
  | { readonly path: FilesystemPath; readonly status: 'busy' | 'stale' }

export type WorkspaceDocumentRecoveryConflictResult =
  | { readonly conflictedPaths: readonly FilesystemPath[]; readonly status: 'acquired' }
  | { readonly path: FilesystemPath; readonly status: 'busy' | 'stale' }

export type WorkspaceDocumentRecoveryLeaseTransfer = {
  readonly operationId: string
}

export type WorkspaceDocumentRecoveryLeaseTransferPreparationResult =
  | {
      readonly status: 'prepared'
      readonly transfer: WorkspaceDocumentRecoveryLeaseTransfer
    }
  | { readonly path: FilesystemPath; readonly status: 'busy' | 'stale' }

type WorkspaceDocumentRecoveryConflictEntry = {
  readonly lease: DocumentMutationLease
  readonly operationId: string
  readonly previousSync: LiveDocumentSync
}

type WorkspaceDocumentRecoveryLeaseTransferData = {
  readonly affectedPaths: readonly FilesystemPath[]
  readonly leaseSet: WorkspaceDocumentMutationLeaseSet
  readonly operationId: string
  readonly retained: readonly {
    readonly document: LiveEditorDocument
    readonly entry: WorkspaceDocumentMutationLeaseEntry
    readonly path: FilesystemPath
  }[]
}

export type UnsyncedLiveEditorDocumentInput = {
  readonly content: string
  readonly target: UnsyncedDocumentRef
}

type SnapshotComparisonGroup = {
  current: Extract<SnapshotComparisonRead, { kind: 'ready' }>
  readonly interests: Map<SnapshotComparisonLease, SnapshotComparisonInterest>
  refresh: SnapshotComparisonRefresh | null
}
type SnapshotComparisonInterest = {
  current: SnapshotComparisonRead
  group: SnapshotComparisonGroup | null
  refresh: SnapshotComparisonRefresh | null
  stop: () => void
}

export type WorkspaceDocumentServiceState = {
  snapshotComparisonTabs: ReadonlyMap<TabId, SnapshotComparisonLease>
  snapshotComparisons: ReadonlyMap<SnapshotComparisonLease, SnapshotComparisonRead>
  savedComparisonTabs: ReadonlyMap<TabId, SavedComparisonLease>
  savedComparisons: ReadonlyMap<SavedComparisonLease, SavedComparisonRead>
  documentContentRevisions: Readonly<Record<DocumentKey, string>>
  dirtyContentRevision: number
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  liveDocumentsByKey: Readonly<Record<DocumentKey, LiveEditorDocument>>
  pathOwnershipRevision: number
  scrollPositionByTabId: Readonly<Record<TabId, EditorScrollPosition>>
  viewsByTabId: Readonly<Record<TabId, EditorDocumentView>>
}

type SavedComparisonInterest = {
  readonly path: FilesystemPath
  readonly scope: SavedComparisonScope
  current: SavedComparisonRead
  savedRefresh: SavedComparisonRefresh | null
  stop: () => void
}

export class WorkspaceDocumentService {
  private snapshotComparisonTabs: ReadonlyMap<TabId, SnapshotComparisonLease> = new Map()
  private snapshotComparisons: ReadonlyMap<SnapshotComparisonLease, SnapshotComparisonRead> =
    new Map()
  private readonly snapshotGroups = new Map<string, SnapshotComparisonGroup>()
  private readonly snapshotInterests = new Map<
    SnapshotComparisonLease,
    SnapshotComparisonInterest
  >()
  private savedComparisonTabs: ReadonlyMap<TabId, SavedComparisonLease> = new Map()
  private savedComparisons: ReadonlyMap<SavedComparisonLease, SavedComparisonRead> = new Map()
  private readonly comparisonInterests = new Map<SavedComparisonLease, SavedComparisonInterest>()
  private sourceOwnerDisposed = false
  private documentContentRevisions: Readonly<Record<DocumentKey, string>> = {}
  private dirtyDocumentKeys: ReadonlySet<DocumentKey> = new Set()
  private dirtyContentRevision = 0
  private pathOwnershipRevision = 0
  private readonly liveDocumentsByKey = new Map<DocumentKey, LiveEditorDocument>()
  private readonly preparationPins = new Map<EditorTextBuffer, Set<object>>()
  private readonly analysisListeners = new Set<() => void>()
  private readonly documentKeysByBuffer = new Map<EditorTextBuffer, DocumentKey>()
  private readonly unsubscribeByBuffer = new Map<EditorTextBuffer, () => void>()
  private readonly recoveryConflictByBuffer = new Map<
    EditorTextBuffer,
    WorkspaceDocumentRecoveryConflictEntry
  >()
  private readonly recoveryLeaseTransfers = new WeakMap<
    WorkspaceDocumentRecoveryLeaseTransfer,
    WorkspaceDocumentRecoveryLeaseTransferData
  >()
  private readonly pathReservations = new Map<FilesystemPath, WorkspaceDocumentPathReservation>()
  private readonly reservedPathsByToken = new WeakMap<
    WorkspaceDocumentPathReservation,
    readonly FilesystemPath[]
  >()
  private readonly ownershipRevisionByPath = new Map<FilesystemPath, number>()
  private readonly viewsByTabId = new Map<TabId, EditorDocumentView>()
  /**
   * Last known scroll position per document, seeded from the workspace cache.
   * Read when a view is created, so a reopened file (or a refreshed app)
   * lands where it was; updated on every scroll write.
   */
  private readonly viewScrollPositionSeeds = new Map<TabId, EditorScrollPosition>()
  private readonly scrollPositionSeeds = new Map<DocumentKey, EditorScrollPosition>()
  private cachedState: WorkspaceDocumentServiceState | null = null

  constructor(
    private readonly onStateChange: () => void = () => undefined,
    private readonly environmentId: EnvironmentId | null = null,
  ) {}

  acquireSnapshotComparison(request: SnapshotComparisonRequest): SnapshotComparisonLease {
    return this.createSnapshotComparisonInterest(request)
  }

  private createSnapshotComparisonInterest(
    { input, signal }: SnapshotComparisonRequest,
    tabId?: TabId,
  ): SnapshotComparisonLease {
    this.assertComparisonOwner(input.scope)
    const entry: SnapshotComparisonInterest = {
      current: {
        kind: 'released',
        reason: this.sourceOwnerDisposed ? 'owner-disposed' : 'interest-ended',
      },
      group: null,
      refresh: null,
      stop: () => undefined,
    }
    const lease: SnapshotComparisonLease = {
      read: () => entry.current,
      requestRefresh: () => {
        const request = { lease }
        if (entry.group) {
          entry.refresh = request
          entry.group.refresh = request
        }
        return request
      },
      refresh: (next, request) => this.refreshSnapshotComparison(lease, next, request),
      release: () => this.releaseSnapshotComparison(lease, 'interest-ended'),
    }
    if (this.sourceOwnerDisposed || signal.aborted) return lease
    const key = snapshotGroupKey(input)
    const group = this.snapshotGroups.get(key) ?? {
      current: { kind: 'ready' as const, input },
      interests: new Map(),
      refresh: null,
    }
    this.snapshotGroups.set(key, group)
    if (group.current.input !== input) this.publishSnapshotInput(group, input)
    entry.group = group
    entry.current = group.current
    group.interests.set(lease, entry)
    this.snapshotInterests.set(lease, entry)
    const release = () => lease.release()
    signal.addEventListener('abort', release, { once: true })
    entry.stop = () => signal.removeEventListener('abort', release)
    this.snapshotComparisons = new Map(this.snapshotComparisons).set(lease, entry.current)
    if (tabId) this.snapshotComparisonTabs = new Map(this.snapshotComparisonTabs).set(tabId, lease)
    this.onStateChange()
    return lease
  }

  prepareSnapshotComparisonTab(
    tabId: TabId,
    request: SnapshotComparisonRequest,
  ): SnapshotComparisonLease {
    this.assertComparisonOwner(request.input.scope)
    if (this.sourceOwnerDisposed || request.signal.aborted)
      return this.acquireSnapshotComparison(request)
    const previous = this.snapshotComparisonTabs.get(tabId)
    const read = previous?.read()
    if (
      previous &&
      read?.kind === 'ready' &&
      snapshotGroupKey(read.input) === snapshotGroupKey(request.input)
    ) {
      if (read.input !== request.input) previous.refresh(request.input, previous.requestRefresh())
      return previous
    }
    previous?.release()
    return this.createSnapshotComparisonInterest(request, tabId)
  }

  acquireSavedComparison({ scope, saved, signal }: SavedComparisonRequest): SavedComparisonLease {
    this.assertComparisonOwner(scope)
    if (saved.seemsBinary)
      throw createClientInvariantError('Comparison source requires text', { sourceKind: 'binary' })
    const entry: SavedComparisonInterest = {
      path: saved.path,
      scope,
      current: this.comparisonRead(scope, saved),
      savedRefresh: null,
      stop: (): void => undefined,
    }
    const lease: SavedComparisonLease = {
      read: () => entry.current,
      requestSavedRefresh: () => this.requestSavedRefresh(lease),
      refreshSaved: (snapshot, request) => this.refreshSavedComparison(lease, snapshot, request),
      release: () => this.releaseSavedComparison(lease, 'interest-ended'),
    }
    if (this.sourceOwnerDisposed || signal.aborted) {
      entry.current = {
        kind: 'released',
        reason: this.sourceOwnerDisposed ? 'owner-disposed' : 'interest-ended',
      }
      return lease
    }
    const release = () => lease.release()
    signal.addEventListener('abort', release, { once: true })
    entry.stop = () => signal.removeEventListener('abort', release)
    this.comparisonInterests.set(lease, entry)
    this.publishComparison(lease, entry.current)
    this.onStateChange()
    return lease
  }

  prepareSavedComparisonTab(tabId: TabId, request: SavedComparisonRequest): SavedComparisonLease {
    this.assertComparisonOwner(request.scope)
    if (this.sourceOwnerDisposed || request.signal.aborted)
      return this.acquireSavedComparison(request)
    const previous = this.savedComparisonTabs.get(tabId)
    const read = previous?.read()
    if (
      previous &&
      read &&
      read.kind !== 'released' &&
      read.saved.snapshot.path === request.saved.path &&
      read.scope.rootPath === request.scope.rootPath
    ) {
      if (read.saved.snapshot !== request.saved)
        previous.refreshSaved(request.saved, previous.requestSavedRefresh())
      return previous
    }
    previous?.release()
    const lease = this.acquireSavedComparison(request)
    if (lease.read().kind === 'released') return lease
    this.savedComparisonTabs = new Map(this.savedComparisonTabs).set(tabId, lease)
    this.onStateChange()
    return lease
  }

  dispose(): void {
    this.sourceOwnerDisposed = true
    for (const lease of this.snapshotInterests.keys())
      this.releaseSnapshotComparison(lease, 'owner-disposed')
    for (const lease of this.comparisonInterests.keys())
      this.releaseSavedComparison(lease, 'owner-disposed')
    const prepared = new Set<EditorPreparedDocument>()
    for (const view of this.viewsByTabId.values()) {
      if (view.preparedDocument) prepared.add(view.preparedDocument)
    }
    this.viewsByTabId.clear()
    for (const document of prepared) document.dispose()
    for (const key of this.liveDocumentsByKey.keys()) this.removeLiveDocument(key)
    this.viewScrollPositionSeeds.clear()
    this.scrollPositionSeeds.clear()
    this.pathReservations.clear()
    this.ownershipRevisionByPath.clear()
    this.preparationPins.clear()
    this.analysisListeners.clear()
  }

  /**
   * The documents `retain` keeps whatever the keep set says — dirty buffers,
   * non-`file` syncs, and paths it cannot reach. Their text is unavoidable, so the
   * retention budget has to charge it before admitting anything optional.
   *
   * Shares one predicate with `retain` deliberately: two copies would drift, and a
   * budget that disagrees with the eviction it is meant to bound is the defect.
   */
  unevictableDocumentKeys(): ReadonlySet<DocumentKey> {
    const keys = new Set<DocumentKey>()
    for (const documentKey of this.liveDocumentsByKey.keys()) {
      if (this.isUnevictableDocument(documentKey)) keys.add(documentKey)
    }

    return keys
  }

  private isUnevictableDocument(documentKey: DocumentKey): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (this.preparationPins.has(document.buffer)) return true
    for (const input of this.savedComparisons.values()) {
      if (input.kind === 'ready' && input.live.buffer === document.buffer) return true
    }
    if (this.isDirtyDocument(documentKey)) return true
    if (document.sync.kind !== 'file' || document.sync.orphaned) return true

    const resource = filesystemResource(document.target)
    return !resource || !this.pathsAvailable([resource.path], null)
  }

  /**
   * Retained text size per live document. Every one, not only the evictable: an
   * unevictable document still occupies memory. `length` is a retained field.
   */
  documentSizes(): ReadonlyMap<DocumentKey, number> {
    const sizes = new Map<DocumentKey, number>()
    for (const [documentKey, document] of this.liveDocumentsByKey) {
      sizes.set(documentKey, document.buffer.getTextSnapshot().length)
    }

    return sizes
  }

  /**
   * The single eviction path. Drops every live document and view outside the keep
   * sets, and nothing else — dirty buffers and unsynced documents (conflict and
   * search buffers, which have no disk backing) are never evictable, so switching
   * projects can no longer destroy unrecoverable content.
   *
   * Deleting through deleteLiveDocument is mandatory, not stylistic: it removes
   * every view bound to the document. A view outliving its document is a hard
   * crash through getRequiredLiveDocument.
   */
  retain({
    documentKeys,
    tabIds,
  }: {
    documentKeys: ReadonlySet<DocumentKey>
    tabIds: ReadonlySet<TabId>
  }): { evictedDocumentKeys: DocumentKey[]; evictedTabIds: TabId[] } {
    for (const [tabId, lease] of this.snapshotComparisonTabs) {
      if (!tabIds.has(tabId)) lease.release()
    }
    for (const [tabId, lease] of this.savedComparisonTabs) {
      if (!tabIds.has(tabId)) lease.release()
    }
    const evictedDocumentKeys: DocumentKey[] = []
    for (const documentKey of this.liveDocumentsByKey.keys()) {
      if (documentKeys.has(documentKey)) continue
      if (this.isUnevictableDocument(documentKey)) continue

      this.deleteLiveDocument(documentKey)
      evictedDocumentKeys.push(documentKey)
    }

    // After the document pass: deleteLiveDocument has already removed the views
    // belonging to evicted documents, so anything left here is a kept document
    // whose tab is simply gone.
    const evictedTabIds: TabId[] = []
    for (const tabId of this.viewsByTabId.keys()) {
      if (tabIds.has(tabId)) continue

      this.viewsByTabId.get(tabId)?.preparedDocument?.dispose()
      this.viewsByTabId.delete(tabId)
      evictedTabIds.push(tabId)
    }

    return { evictedDocumentKeys, evictedTabIds }
  }

  deleteLiveDocument(documentKey: DocumentKey): { hadLiveDocument: boolean; wasDirty: boolean } {
    const resource = filesystemResource(this.liveDocumentsByKey.get(documentKey)?.target)
    if (resource) this.assertPathsAvailable([resource.path])
    return this.removeLiveDocument(documentKey)
  }

  private removeLiveDocument(documentKey: DocumentKey): {
    hadLiveDocument: boolean
    wasDirty: boolean
  } {
    const document = this.liveDocumentsByKey.get(documentKey)
    const resource = filesystemResource(document?.target)
    const wasDirty = this.isDirtyDocument(documentKey)
    const hadLiveDocument = this.liveDocumentsByKey.delete(documentKey)
    if (hadLiveDocument) this.notifyEditorAnalyses()
    if (document) this.detachPreviousBuffer(document)
    if (hadLiveDocument) {
      this.pathOwnershipRevision += 1
      if (resource) this.advancePathOwnership(resource.path)
    }

    this.deleteDirtyKey(documentKey)
    this.documentContentRevisions = omitKey(this.documentContentRevisions, documentKey)
    this.refreshLiveComparison(documentKey)

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentKey !== documentKey) continue

      view.preparedDocument?.dispose()
      this.viewsByTabId.delete(tabId)
    }

    return { hadLiveDocument, wasDirty }
  }

  ensureLiveDocument(
    file: FileSnapshot,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorDocument {
    assertTextFile(file)
    this.assertPathsAvailable([file.path])
    const existing = this.liveDocumentsByKey.get(fileDocumentKey(file.path))
    const cleanClaim = cleanClaimForFile(claim, file)
    if (existing?.sync.kind === 'recovery-conflict') return existing
    if (existing?.sync.kind === 'file' && existing.sync.fileVersion === file.version) {
      if (existing.sync.mtimeMs === file.mtimeMs) return existing
      // Save checks the timestamp too; identical disk bytes can advance it while edits stay dirty.
      const refreshed = {
        ...existing,
        sync: { ...existing.sync, mtimeMs: file.mtimeMs },
      }
      this.setLiveDocument(refreshed)
      return refreshed
    }
    if (existing?.buffer.isDirty()) return existing

    // A touched file with the same bytes keeps its buffer, so the undo history survives.
    const record = existing
      ? this.replacementDocument(file, existing, cleanClaim)
      : this.createFileDocument(file, cleanClaim)
    this.setContentRevision(record.key, record.contentRevision)
    this.deleteDirtyKey(record.key)
    this.setLiveDocument(record)
    if (record.buffer !== existing?.buffer) this.rebindViewsForDocument(record.key)
    return record
  }

  acquireFilePreparation(
    input: FileOpenIntentPreparationSourceInput,
  ): FileOpenIntentPreparationSource | null {
    if (this.sourceOwnerDisposed) return null
    const acquired =
      input.kind === 'live-document'
        ? this.liveDocumentsByKey.get(input.documentKey)
        : this.ensureLiveDocument(input.file)
    if (!acquired) return null
    const document = this.liveDocumentsByKey.get(acquired.key)
    if (!document || document.buffer !== acquired.buffer) return null
    const { buffer } = document
    const token = {}
    const pins = this.preparationPins.get(buffer) ?? new Set<object>()
    pins.add(token)
    this.preparationPins.set(buffer, pins)
    return {
      document,
      release: () => {
        if (!pins.delete(token)) return
        if (pins.size === 0 && this.preparationPins.get(buffer) === pins)
          this.preparationPins.delete(buffer)
      },
    }
  }

  *enumerateEditorAnalyses(): Iterable<EditorDocumentAnalysis> {
    for (const document of this.liveDocumentsByKey.values()) yield document.analysis
  }

  subscribeEditorAnalyses(listener: () => void): () => void {
    this.analysisListeners.add(listener)
    return () => this.analysisListeners.delete(listener)
  }

  private notifyEditorAnalyses(): void {
    for (const listener of this.analysisListeners) listener()
  }

  ensureView(
    tabId: TabId,
    file: FileSnapshot,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorViewDocument {
    try {
      const document = this.ensureLiveDocument(file, claim)
      return this.attachViewForDocument(tabId, document.key, claim)
    } catch (error) {
      claim?.preparedDocument?.dispose()
      throw error
    } finally {
      claim?.release()
    }
  }

  ensureUnsyncedDocument(input: UnsyncedLiveEditorDocumentInput): LiveEditorDocument {
    const key = documentKey(input.target)
    const existing = this.liveDocumentsByKey.get(key)
    if (existing?.buffer.isDirty()) return existing
    if (existing && textSnapshotEqualsText(existing.buffer.getTextSnapshot(), input.content)) {
      return existing
    }

    const record = this.createUnsyncedDocument(input)
    this.setLiveDocument(record)
    this.setContentRevision(key, record.contentRevision)
    this.rebindViewsForDocument(key)
    return record
  }

  ensureSettingsDocument(
    target: SettingsDocumentRef,
    snapshot: { readonly content: string; readonly revision: string },
  ): LiveEditorDocument {
    const key = documentKey(target)
    const existing = this.liveDocumentsByKey.get(key)
    if (existing) return existing
    const buffer = createHistoryBuffer(snapshot.content)
    buffer.markClean()
    const record: LiveEditorDocument = {
      analysis: createEditorDocumentAnalysis({ buffer, documentId: key }),
      buffer,
      contentRevision: contentRevisionForText(snapshot.content),
      key,
      localRevision: buffer.getRevision(),
      target,
      sync: { kind: 'settings', revision: snapshot.revision, state: 'idle' },
    }
    this.setLiveDocument(record)
    this.setContentRevision(key, record.contentRevision)
    return record
  }

  ensureViewForDocument(
    tabId: TabId,
    documentKey: DocumentKey,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorViewDocument {
    try {
      return this.attachViewForDocument(tabId, documentKey, claim)
    } catch (error) {
      claim?.preparedDocument?.dispose()
      throw error
    } finally {
      claim?.release()
    }
  }

  private attachViewForDocument(
    tabId: TabId,
    documentKey: DocumentKey,
    claim: PreparedFileOpenClaim | null,
  ): LiveEditorViewDocument {
    const document = this.getRequiredLiveDocument(documentKey)
    const resource = filesystemResource(document.target)
    if (resource) this.assertPathsAvailable([resource.path])
    const existing = this.viewsByTabId.get(tabId)
    if (existing?.documentKey === document.key) {
      const preparedDocument = preparedDocumentForClaim(document, claim)
      if (preparedDocument) {
        existing.preparedDocument?.dispose()
        this.viewsByTabId.set(tabId, { ...existing, preparedDocument })
        return this.viewDocumentProjection(this.viewsByTabId.get(tabId)!)
      }
      return this.viewDocumentProjection(existing)
    }

    const scrollPosition =
      existing?.scrollPosition ??
      this.viewScrollPositionSeeds.get(tabId) ??
      this.scrollPositionSeeds.get(document.key)
    const view = createEditorViewSession(document.buffer, `tab:${tabId}`)
    view.setScrollPosition(scrollPosition)
    const nextView: EditorDocumentView = {
      reopenScrollPosition: this.scrollPositionSeeds.get(document.key) ?? scrollPosition,
      documentKey: document.key,
      preparedDocument: preparedDocumentForClaim(document, claim),
      scrollPosition,
      tabId,
      view,
    }
    this.viewsByTabId.set(tabId, nextView)

    return this.viewDocumentProjection(nextView)
  }

  removeView(tabId: TabId): boolean {
    this.snapshotComparisonTabs.get(tabId)?.release()
    this.savedComparisonTabs.get(tabId)?.release()
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false

    view.preparedDocument?.dispose()
    this.viewsByTabId.delete(tabId)
    return true
  }

  forceReplaceLiveDocument(file: FileSnapshot): { changed: boolean; wasDirty: boolean } {
    assertTextFile(file)
    this.assertPathsAvailable([file.path])
    const wasDirty = this.isDirtyDocument(fileDocumentKey(file.path))
    const existing = this.liveDocumentsByKey.get(fileDocumentKey(file.path))
    if (existing && !wasDirty && fileSyncVersion(existing) === file.version) {
      if (
        textSnapshotEqualsText(existing.buffer.getTextSnapshot(), materializeFileSnapshotText(file))
      ) {
        return { changed: false, wasDirty: false }
      }
    }

    const record = this.replacementDocument(file, existing)

    this.setLiveDocument(record)
    this.setContentRevision(record.key, record.contentRevision)
    this.deleteDirtyKey(record.key)
    if (record.buffer !== existing?.buffer) this.rebindViewsForDocument(record.key)
    return { changed: true, wasDirty }
  }

  getLiveDocument(documentKey: DocumentKey): LiveEditorDocument | null {
    return this.liveDocumentsByKey.get(documentKey) ?? null
  }

  getView(tabId: TabId): EditorDocumentView | null {
    return this.viewsByTabId.get(tabId) ?? null
  }

  getViewDocument(tabId: TabId): LiveEditorViewDocument | null {
    const record = this.viewsByTabId.get(tabId)
    if (!record) return null

    return this.viewDocumentProjection(record)
  }

  prepareTargetStamp(documentKey: DocumentKey): WorkspaceDocumentTargetStamp | null {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document || document.target.kind !== 'file') return null

    return {
      buffer: document.buffer,
      bufferRevision: document.buffer.getRevision(),
      contentRevision: document.contentRevision,
      dirty: this.isDirtyDocument(documentKey),
      documentKey,
      localRevision: document.localRevision,
      path: document.target.resource.path,
      snapshot: document.buffer.getSnapshot(),
      sync: document.sync,
    }
  }

  isTargetStampCurrent(stamp: WorkspaceDocumentTargetStamp): boolean {
    const document = this.liveDocumentsByKey.get(stamp.documentKey)
    if (!document) return false
    if (document.buffer !== stamp.buffer) return false
    if (document.buffer.getRevision() !== stamp.bufferRevision) return false
    if (document.buffer.getSnapshot() !== stamp.snapshot) return false
    if (document.localRevision !== stamp.localRevision) return false
    if (document.contentRevision !== stamp.contentRevision) return false
    if (filesystemResource(document.target)?.path !== stamp.path || document.sync !== stamp.sync)
      return false
    return this.isDirtyDocument(stamp.documentKey) === stamp.dirty
  }

  preparePathReservation(path: FilesystemPath): WorkspaceDocumentPathReservationRequest {
    return {
      canonicalPath: path,
      expectedDocumentKey: this.liveDocumentsByKey.has(fileDocumentKey(path))
        ? fileDocumentKey(path)
        : null,
      expectedPathOwnershipRevision: this.pathOwnershipRevisionFor(path),
    }
  }

  reservePaths(
    requests: readonly WorkspaceDocumentPathReservationRequest[],
    ownerId: string,
  ): WorkspaceDocumentPathReservationResult {
    const ordered = canonicalReservationRequests(requests)
    if (!ordered) return { status: 'stale' }
    for (const request of ordered) {
      if (!this.pathReservationRequestIsCurrent(request)) return { status: 'stale' }
      if (this.pathReservations.has(request.canonicalPath)) return { status: 'busy' }
    }

    const reservation = Object.freeze({ ownerId }) as WorkspaceDocumentPathReservation
    const paths = Object.freeze(ordered.map((request) => request.canonicalPath))
    this.reservedPathsByToken.set(reservation, paths)
    for (const path of paths) this.pathReservations.set(path, reservation)
    return { reservation, status: 'acquired' }
  }

  releasePaths(
    reservation: WorkspaceDocumentPathReservation,
  ): ReleaseWorkspaceDocumentPathReservationResult {
    const paths = this.reservedPathsByToken.get(reservation)
    if (!paths) return { status: 'already-released' }

    for (const path of paths) {
      if (this.pathReservations.get(path) === reservation) this.pathReservations.delete(path)
    }
    this.reservedPathsByToken.delete(reservation)
    return { status: 'released' }
  }

  acquireMutationLeases(
    stamps: readonly WorkspaceDocumentTargetStamp[],
    ownerId: string,
  ): WorkspaceDocumentMutationLeaseResult {
    const acquired: WorkspaceDocumentMutationLeaseEntry[] = []
    const ordered = uniqueTargetStamps(stamps)
    for (const stamp of ordered) {
      const result = acquireDocumentMutationLease(
        stamp.buffer,
        stamp.bufferRevision,
        stamp.snapshot,
        ownerId,
      )
      if (result.status === 'acquired') {
        acquired.push({ buffer: stamp.buffer, lease: result.lease, path: stamp.path })
        continue
      }

      releaseMutationLeaseEntries(acquired)
      return { path: stamp.path, status: result.status }
    }

    return {
      leaseSet: Object.freeze({ entries: Object.freeze(acquired), ownerId }),
      status: 'acquired',
    }
  }

  releaseMutationLeases(leaseSet: WorkspaceDocumentMutationLeaseSet): boolean {
    return releaseMutationLeaseEntries(leaseSet.entries)
  }

  retainMutationLeasesForPaths(
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly FilesystemPath[],
  ): WorkspaceDocumentMutationLeaseSet {
    const affected = new Set(affectedPaths)
    const retained: WorkspaceDocumentMutationLeaseEntry[] = []
    for (const entry of leaseSet.entries) {
      const documentKey = this.documentKeysByBuffer.get(entry.buffer)
      const document = documentKey ? this.liveDocumentsByKey.get(documentKey) : null
      const resource = filesystemResource(document?.target)
      if (resource && affected.has(resource.path)) {
        retained.push({ ...entry, path: resource.path })
        continue
      }
      releaseDocumentMutationLease(entry.buffer, entry.lease)
    }
    return Object.freeze({ entries: Object.freeze(retained), ownerId: leaseSet.ownerId })
  }

  prepareMutationLeaseRecoveryConflictTransfer(
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ): WorkspaceDocumentRecoveryLeaseTransferPreparationResult {
    const paths = Array.from(new Set(affectedPaths)).sort()
    const affected = new Set(paths)
    const retained = leaseSet.entries.flatMap((entry) => {
      const documentKey = this.documentKeysByBuffer.get(entry.buffer)
      const document = documentKey ? this.liveDocumentsByKey.get(documentKey) : null
      const resource = filesystemResource(document?.target)
      if (!document || !resource || !affected.has(resource.path)) return []
      return [{ document, entry, path: resource.path }]
    })
    for (const { document, path } of retained) {
      if (!this.recoveryConflictByBuffer.has(document.buffer)) continue
      return { path, status: 'busy' }
    }

    const transfer = Object.freeze({ operationId })
    this.recoveryLeaseTransfers.set(transfer, {
      affectedPaths: paths,
      leaseSet,
      operationId,
      retained,
    })
    return { status: 'prepared', transfer }
  }

  commitMutationLeaseRecoveryConflictTransfer(
    transfer: WorkspaceDocumentRecoveryLeaseTransfer,
  ): readonly FilesystemPath[] {
    const prepared = this.recoveryLeaseTransfers.get(transfer)
    if (!prepared) {
      throw createClientInvariantError('Recovery lease transfer was not prepared')
    }
    this.recoveryLeaseTransfers.delete(transfer)

    const retainedBuffers = new Set(prepared.retained.map(({ entry }) => entry.buffer))
    for (const entry of prepared.leaseSet.entries) {
      if (retainedBuffers.has(entry.buffer)) continue
      releaseDocumentMutationLease(entry.buffer, entry.lease)
    }
    for (const { document, entry } of prepared.retained) {
      this.recoveryConflictByBuffer.set(document.buffer, {
        lease: entry.lease,
        operationId: prepared.operationId,
        previousSync: document.sync,
      })
      this.setLiveDocument({
        ...document,
        sync: {
          affectedPaths: prepared.affectedPaths,
          kind: 'recovery-conflict',
          operationId: prepared.operationId,
        },
      })
    }
    return prepared.retained.map(({ path }) => path)
  }

  markRecoveryConflict(
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ): WorkspaceDocumentRecoveryConflictResult {
    const paths = Array.from(new Set(affectedPaths)).sort()
    const documents = paths.flatMap((path) => {
      const document = this.liveDocumentsByKey.get(fileDocumentKey(path))
      return document ? [{ document, path }] : []
    })
    const acquired: Array<{
      document: LiveEditorDocument
      entry: WorkspaceDocumentRecoveryConflictEntry
    }> = []

    for (const { document, path } of documents) {
      const existing = this.recoveryConflictByBuffer.get(document.buffer)
      if (existing?.operationId === operationId) continue
      if (existing) {
        releaseRecoveryConflictEntries(acquired)
        return { path, status: 'busy' }
      }

      const result = acquireDocumentMutationLease(
        document.buffer,
        document.buffer.getRevision(),
        document.buffer.getSnapshot(),
        `workspace-recovery:${operationId}`,
      )
      if (result.status !== 'acquired') {
        releaseRecoveryConflictEntries(acquired)
        return { path, status: result.status }
      }
      acquired.push({
        document,
        entry: {
          lease: result.lease,
          operationId,
          previousSync: document.sync,
        },
      })
    }

    for (const { document, entry } of acquired) {
      this.recoveryConflictByBuffer.set(document.buffer, entry)
      this.setLiveDocument({
        ...document,
        sync: {
          affectedPaths: paths,
          kind: 'recovery-conflict',
          operationId,
        },
      })
    }
    return {
      conflictedPaths: documents.map(({ path }) => path),
      status: 'acquired',
    }
  }

  clearRecoveryConflict(operationId: string): readonly FilesystemPath[] {
    const cleared: FilesystemPath[] = []
    for (const [buffer, entry] of this.recoveryConflictByBuffer) {
      if (entry.operationId !== operationId) continue
      const documentKey = this.documentKeysByBuffer.get(buffer)
      const document = documentKey ? this.liveDocumentsByKey.get(documentKey) : null
      releaseDocumentMutationLease(buffer, entry.lease)
      this.recoveryConflictByBuffer.delete(buffer)
      if (!document || document.sync.kind !== 'recovery-conflict') continue
      if (document.sync.operationId !== operationId) continue
      const resource = filesystemResource(document.target)
      if (!resource) continue
      this.setLiveDocument({ ...document, sync: entry.previousSync })
      cleared.push(resource.path)
    }
    return cleared
  }

  prepareRenameProjection(
    from: FilesystemPath,
    to: FilesystemPath,
    reservation: WorkspaceDocumentPathReservation | null = null,
  ): WorkspaceDocumentRenameProjection | null {
    if (!this.pathsAvailable([from, to], reservation)) return null
    if (from === to) return { from, kind: 'rename', reservation, source: null, to }
    if (this.liveDocumentsByKey.has(fileDocumentKey(to))) return null

    return {
      from,
      kind: 'rename',
      reservation,
      source: this.prepareTargetStamp(fileDocumentKey(from)),
      to,
    }
  }

  prepareDeleteProjection(
    path: FilesystemPath,
    reservation: WorkspaceDocumentPathReservation | null = null,
  ): WorkspaceDocumentDeleteProjection | null {
    if (!this.pathsAvailable([path], reservation)) return null
    const document = this.liveDocumentsByKey.get(fileDocumentKey(path))
    const stamp = this.prepareTargetStamp(fileDocumentKey(path))
    if (!document || !stamp) return null

    const views = Array.from(this.viewsByTabId.values()).filter(
      (view) => view.documentKey === document.key,
    )
    return {
      contentRevision: this.documentContentRevisions[document.key],
      dirty: this.isDirtyDocument(document.key),
      document,
      kind: 'delete',
      reservation,
      stamp,
      views,
    }
  }

  commitProjection(projection: WorkspaceDocumentProjection): boolean {
    if (!this.projectionPathsAvailable(projection)) return false
    if (projection.kind === 'delete') return this.commitDeleteProjection(projection)
    if (!projection.source) return true
    if (!this.isTargetStampCurrent(projection.source)) return false
    if (this.liveDocumentsByKey.has(fileDocumentKey(projection.to))) return false

    this.renameLiveDocumentForOwner(projection.from, projection.to)
    return true
  }

  rollbackProjection(projection: WorkspaceDocumentProjection): boolean {
    if (!this.projectionPathsAvailable(projection)) return false
    if (projection.kind === 'delete') return this.rollbackDeleteProjection(projection)
    if (!projection.source) return true
    if (this.liveDocumentsByKey.has(fileDocumentKey(projection.from))) return false

    const current = this.liveDocumentsByKey.get(fileDocumentKey(projection.to))
    if (current?.buffer !== projection.source.buffer) return false
    this.renameLiveDocumentForOwner(projection.to, projection.from)
    return true
  }

  hasLiveDocument(documentKey: DocumentKey): boolean {
    return this.liveDocumentsByKey.has(documentKey)
  }

  setFileOrphaned(documentKey: DocumentKey, orphaned: boolean): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document || document.sync.kind !== 'file') return false
    if (document.sync.orphaned === orphaned) return false
    this.setLiveDocument({ ...document, sync: { ...document.sync, orphaned } })
    return true
  }

  markSaved({
    fileVersion,
    documentKey,
    mtimeMs,
    savedContentRevision,
    savedText,
  }: {
    fileVersion: string
    documentKey: DocumentKey
    mtimeMs: number
    savedContentRevision: string
    savedText: string
  }): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind !== 'file') return false

    return this.applySaved(
      document,
      { ...document.sync, fileVersion, mtimeMs, orphaned: false, state: 'idle' },
      savedContentRevision,
      savedText,
    )
  }

  /**
   * The raw settings write landed. `revision` is the file's new hash, which the
   * next save guards on — without advancing it every subsequent save of the same
   * buffer refuses itself as stale.
   */
  markSettingsSaved({
    documentKey,
    revision,
    savedContentRevision,
    savedText,
  }: {
    documentKey: DocumentKey
    revision: string
    savedContentRevision: string
    savedText: string
  }): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false

    return this.applySaved(
      document,
      { kind: 'settings', revision, state: 'idle' },
      savedContentRevision,
      savedText,
    )
  }

  markSettingsConflict(
    documentKey: DocumentKey,
    confirmedText: string | null,
    revision: string | null,
  ): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false

    this.setLiveDocument({
      ...document,
      sync: {
        confirmedText,
        kind: 'settings',
        revision,
        state: 'conflict',
      },
    })
    return true
  }

  reloadSettingsDocument(documentKey: DocumentKey): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind !== 'settings' || document.sync.state !== 'conflict') return false
    if (document.sync.confirmedText === null || document.sync.revision === null) return false

    const { confirmedText, revision } = document.sync
    return this.resetDocumentText(document, confirmedText, {
      kind: 'settings',
      revision,
      state: 'idle',
    })
  }

  /**
   * Re-seeds an unsynced buffer from text it did not produce.
   *
   * A raw settings save is not always byte-preserving: the server lifts a
   * provider credential out of the document into the secret store and rewrites
   * that subtree, so what is on disk afterwards is not what was posted. Leaving
   * the buffer holding the old text would show a secret that is no longer in the
   * file, and the next save would put it back.
   */
  replaceUnsyncedDocumentText(documentKey: DocumentKey, text: string): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind === 'file') return false
    if (textSnapshotEqualsText(document.buffer.getTextSnapshot(), text)) return false

    return this.resetDocumentText(document, text)
  }

  /**
   * Brings a settings buffer back in step with the file.
   *
   * The buffer guards its save on the revision it was seeded from, and only a
   * successful save advances that. Without this, any other write to the same
   * layer — a toggle on the settings form, another window, a hand-edit — leaves
   * the buffer holding a revision the server has moved past, and every save from
   * then on refuses itself as stale with no way back. Documents also outlive
   * their tab (`retain` only evicts file-backed ones), so a reopened settings tab
   * would otherwise show whatever the bytes were when it was last opened.
   *
   * A dirty buffer is left alone on purpose: the user is mid-edit, and replacing
   * their text is worse than the conflict they get on save, which at least says
   * what happened.
   */
  reconcileSettingsDocument(documentKey: DocumentKey, text: string, revision: string): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false
    if (document.sync.revision === revision) return false
    if (document.sync.state === 'conflict') {
      return this.markSettingsConflict(documentKey, text, revision)
    }
    if (document.buffer.isDirty()) return false

    return this.resetDocumentText(document, text, { kind: 'settings', revision, state: 'idle' })
  }

  private resetDocumentText(
    document: LiveEditorDocument,
    text: string,
    sync = document.sync,
  ): boolean {
    const buffer = createHistoryBuffer(text)
    buffer.markClean()
    const contentRevision = contentRevisionForText(text)
    this.setLiveDocument({
      ...document,
      analysis: createEditorDocumentAnalysis({ buffer, documentId: document.key }),
      buffer,
      contentRevision,
      localRevision: buffer.getRevision(),
      sync,
    })
    this.setContentRevision(document.key, contentRevision)
    this.deleteDirtyKey(document.key)
    this.rebindViewsForDocument(document.key)
    return true
  }

  private applySaved(
    document: LiveEditorDocument,
    sync: LiveDocumentSync,
    savedContentRevision: string,
    savedText: string,
  ): boolean {
    // The write already landed on disk, so the sync metadata advances even
    // when in-flight edits make the content checks below fail.
    const synced: LiveEditorDocument = { ...document, sync }
    this.setLiveDocument(synced)
    if (document.contentRevision !== savedContentRevision) return false
    if (!textSnapshotEqualsText(document.buffer.getTextSnapshot(), savedText)) return false

    document.buffer.markClean()
    const cleanContentRevision =
      sync.kind === 'file' ? fileContentRevision(sync.fileVersion) : synced.contentRevision
    this.setLiveDocument({
      ...synced,
      contentRevision: cleanContentRevision,
      localRevision: document.buffer.getRevision(),
    })
    this.setContentRevision(document.key, cleanContentRevision)
    this.deleteDirtyKey(document.key)
    return true
  }

  renameLiveDocument(from: FilesystemPath, to: FilesystemPath): { wasDirty: boolean } {
    this.assertPathsAvailable([from, to])
    const source = this.liveDocumentsByKey.get(fileDocumentKey(from))
    if (source?.sync.kind === 'recovery-conflict') {
      throw createClientInvariantError('Recovery-conflicted documents cannot be renamed')
    }
    return this.renameLiveDocumentForOwner(from, to)
  }

  private renameLiveDocumentForOwner(
    from: FilesystemPath,
    to: FilesystemPath,
  ): { wasDirty: boolean } {
    const fromKey = fileDocumentKey(from)
    const toKey = fileDocumentKey(to)
    const wasDirty = this.isDirtyDocument(fromKey)
    const document = this.liveDocumentsByKey.get(fromKey)
    const contentRevision = this.documentContentRevisions[fromKey]

    this.liveDocumentsByKey.delete(fromKey)
    if (document) this.preparationPins.delete(document.buffer)
    this.documentContentRevisions = omitKey(this.documentContentRevisions, fromKey)
    this.renameDirtyKey(fromKey, toKey)

    if (contentRevision !== undefined) this.setContentRevision(toKey, contentRevision)
    if (document) {
      const renamed = {
        ...document,
        key: toKey,
        target: fileDocument({ path: to }),
      }
      this.liveDocumentsByKey.set(toKey, renamed)
      this.documentKeysByBuffer.set(document.buffer, toKey)
      this.notifyEditorAnalyses()
      this.pathOwnershipRevision += 1
      this.advancePathOwnership(from)
      this.advancePathOwnership(to)
    }

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentKey !== fromKey) continue

      view.preparedDocument?.dispose()
      this.viewsByTabId.set(tabId, { ...view, documentKey: toKey, preparedDocument: null })
    }

    this.refreshLiveComparison(fromKey)
    this.refreshLiveComparison(toKey)
    return { wasDirty }
  }

  setDirty(documentKey: DocumentKey, dirty: boolean): void {
    if (dirty) {
      this.addDirtyKey(documentKey)
      return
    }

    this.deleteDirtyKey(documentKey)
  }

  setViewScrollPosition(
    tabId: TabId,
    scrollPosition: EditorScrollPosition,
    reopenScrollPosition: EditorScrollPosition = scrollPosition,
  ): boolean {
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false
    if (
      scrollPositionsEqual(view.scrollPosition, scrollPosition) &&
      scrollPositionsEqual(view.reopenScrollPosition, reopenScrollPosition)
    )
      return false

    this.viewsByTabId.set(tabId, { ...view, scrollPosition, reopenScrollPosition })
    this.scrollPositionSeeds.set(view.documentKey, reopenScrollPosition)
    view.view.setScrollPosition(scrollPosition)
    return true
  }

  seedViewScrollPositions(entries: readonly EditorViewScrollPosition[]): void {
    this.viewScrollPositionSeeds.clear()
    for (const entry of entries) this.viewScrollPositionSeeds.set(entry.tabId, entry.position)
  }

  copyView(from: TabId, to: TabId): void {
    const snapshot = this.snapshotComparisonTabs.get(from)?.read()
    if (snapshot?.kind === 'ready')
      this.prepareSnapshotComparisonTab(to, {
        input: snapshot.input,
        signal: new AbortController().signal,
      })
    const comparison = this.savedComparisonTabs.get(from)?.read()
    if (comparison && comparison.kind !== 'released')
      this.prepareSavedComparisonTab(to, {
        scope: comparison.scope,
        saved: comparison.saved.snapshot,
        signal: new AbortController().signal,
      })
    const source = this.viewsByTabId.get(from)
    if (!source || this.viewsByTabId.has(to)) return
    const destination = this.ensureViewForDocument(to, source.documentKey)
    destination.view.acceptBufferSelections(source.view.getSelections())
    destination.view.setFoldState(source.view.getFoldState())
    const position = source.view.getScrollPosition() ?? source.scrollPosition
    if (position) this.setViewScrollPosition(to, position, source.reopenScrollPosition ?? position)
  }

  seedScrollPositions(entries: readonly ReopenScrollPosition[]): void {
    this.scrollPositionSeeds.clear()
    for (const { content, position } of entries) {
      for (const target of tabDocuments(content))
        this.scrollPositionSeeds.set(documentKey(target), position)
    }
  }

  /**
   * Documents and views are replaced on write, never mutated in place, so an
   * unchanged entry keeps its identity for free and a slice is reused wholesale
   * when every entry survives. That is what lets high-frequency writes
   * (per-frame scroll position updates) notify the store without re-rendering
   * subscribers of unrelated slices.
   */
  state(): WorkspaceDocumentServiceState {
    const previous = this.cachedState
    const viewsByTabId = recordFromMap(this.viewsByTabId, previous?.viewsByTabId)
    const next: WorkspaceDocumentServiceState = {
      snapshotComparisonTabs: this.snapshotComparisonTabs,
      snapshotComparisons: this.snapshotComparisons,
      savedComparisonTabs: this.savedComparisonTabs,
      savedComparisons: this.savedComparisons,
      documentContentRevisions: this.documentContentRevisions,
      dirtyContentRevision: this.dirtyContentRevision,
      dirtyDocumentKeys: this.dirtyDocumentKeys,
      liveDocumentsByKey: recordFromMap(this.liveDocumentsByKey, previous?.liveDocumentsByKey),
      pathOwnershipRevision: this.pathOwnershipRevision,
      scrollPositionByTabId: this.scrollPositionsState(
        viewsByTabId,
        previous?.scrollPositionByTabId,
      ),
      viewsByTabId,
    }
    this.cachedState = next
    return next
  }

  private scrollPositionsState(
    viewsByTabId: Readonly<Record<TabId, EditorDocumentView>>,
    previous: Readonly<Record<string, EditorScrollPosition>> | undefined,
  ): Readonly<Record<string, EditorScrollPosition>> {
    let count = 0
    let unchanged = previous !== undefined
    const next: Record<string, EditorScrollPosition> = {}
    for (const [tabId, view] of Object.entries(viewsByTabId)) {
      if (view.scrollPosition === undefined) continue
      next[tabId] = view.scrollPosition
      count += 1
      if (previous?.[tabId] !== view.scrollPosition) unchanged = false
    }
    if (unchanged && previous && Object.keys(previous).length === count) return previous
    return next
  }

  private createFileDocument(
    file: FileSnapshot,
    claim: Extract<PreparedFileOpenClaim, { readonly kind: 'clean' }> | null = null,
  ): LiveEditorDocument {
    if (!claim) markEditorOpenBenchmark('editor.file_open.buffer_built', file.path)
    const buffer = claim?.buffer ?? createHistoryBuffer(materializeFileSnapshotDocumentText(file))
    const target = fileDocument({ path: file.path })
    buffer.markClean()

    return {
      analysis:
        claim?.preparedDocument.analysis ??
        createEditorDocumentAnalysis({ buffer, documentId: documentKey(target) }),
      buffer,
      contentRevision: fileContentRevision(file.version),
      key: documentKey(target),
      localRevision: buffer.getRevision(),
      target,
      sync: {
        fileVersion: file.version,
        kind: 'file',
        orphaned: false,
        mtimeMs: file.mtimeMs,
        state: 'idle',
      },
    }
  }

  private createUnsyncedDocument(input: UnsyncedLiveEditorDocumentInput): LiveEditorDocument {
    const buffer = createHistoryBuffer(input.content)
    buffer.markClean()

    return {
      analysis: createEditorDocumentAnalysis({ buffer, documentId: documentKey(input.target) }),
      buffer,
      contentRevision: contentRevisionForText(input.content),
      key: documentKey(input.target),
      localRevision: buffer.getRevision(),
      target: input.target,
      sync: { kind: 'none' },
    }
  }

  private replacementDocument(
    file: FileSnapshot,
    existing: LiveEditorDocument | undefined,
    claim: Extract<PreparedFileOpenClaim, { readonly kind: 'clean' }> | null = null,
  ): LiveEditorDocument {
    if (!existing) return this.createFileDocument(file, claim)
    if (
      !textSnapshotEqualsText(existing.buffer.getTextSnapshot(), materializeFileSnapshotText(file))
    ) {
      return this.createFileDocument(file, claim)
    }

    existing.buffer.markClean()
    return {
      ...existing,
      contentRevision: fileContentRevision(file.version),
      localRevision: existing.buffer.getRevision(),
      sync: {
        fileVersion: file.version,
        kind: 'file',
        orphaned: false,
        mtimeMs: file.mtimeMs,
        state: 'idle',
      },
    }
  }

  private rebindViewsForDocument(documentKey: DocumentKey): void {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentKey !== documentKey) continue

      const nextView = createEditorViewSession(document.buffer, `tab:${tabId}`)
      nextView.setScrollPosition(view.scrollPosition)
      this.viewsByTabId.set(tabId, {
        ...view,
        preparedDocument: null,
        view: nextView,
      })
      view.preparedDocument?.dispose()
    }
  }

  private viewDocumentProjection(view: EditorDocumentView): LiveEditorViewDocument {
    const document = this.getRequiredLiveDocument(view.documentKey)

    return {
      ...document,
      preparedDocument: view.preparedDocument,
      scrollPosition: view.scrollPosition,
      tabId: view.tabId,
      view: view.view,
    }
  }

  private getRequiredLiveDocument(documentKey: DocumentKey): LiveEditorDocument {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) {
      throw createClientInvariantError(`Missing live document ${documentKey}`)
    }

    return document
  }

  isDirtyDocument(documentKey: DocumentKey): boolean {
    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document) return this.dirtyDocumentKeys.has(documentKey)
    if (this.dirtyDocumentKeys.has(document.key)) return true

    return document.buffer.isDirty()
  }

  private projectionPathsAvailable(projection: WorkspaceDocumentProjection): boolean {
    if (projection.kind === 'delete') {
      return this.pathsAvailable([projection.stamp.path], projection.reservation)
    }
    return this.pathsAvailable([projection.from, projection.to], projection.reservation)
  }

  private pathsAvailable(
    paths: readonly FilesystemPath[],
    reservationToken: WorkspaceDocumentPathReservation | null,
  ): boolean {
    for (const path of paths) {
      const reservation = this.pathReservations.get(path)
      if (!reservation) continue
      if (reservation === reservationToken) continue
      return false
    }
    return true
  }

  private assertPathsAvailable(paths: readonly FilesystemPath[]): void {
    if (this.pathsAvailable(paths, null)) return
    throw createClientInvariantError('Workspace document path is reserved by another mutation')
  }

  private pathReservationRequestIsCurrent(
    request: WorkspaceDocumentPathReservationRequest,
  ): boolean {
    const documentKey = this.liveDocumentsByKey.has(fileDocumentKey(request.canonicalPath))
      ? fileDocumentKey(request.canonicalPath)
      : null
    if (documentKey !== request.expectedDocumentKey) return false
    return (
      this.pathOwnershipRevisionFor(request.canonicalPath) === request.expectedPathOwnershipRevision
    )
  }

  private pathOwnershipRevisionFor(path: FilesystemPath): number {
    return this.ownershipRevisionByPath.get(path) ?? 0
  }

  private advancePathOwnership(path: FilesystemPath): void {
    this.ownershipRevisionByPath.set(path, this.pathOwnershipRevisionFor(path) + 1)
  }

  private renameDirtyKey(from: DocumentKey, to: DocumentKey): void {
    if (!this.dirtyDocumentKeys.has(from)) return

    const next = new Set(this.dirtyDocumentKeys)
    next.delete(from)
    next.add(to)
    this.dirtyDocumentKeys = next
  }

  private addDirtyKey(path: DocumentKey): void {
    if (this.dirtyDocumentKeys.has(path)) return

    const next = new Set(this.dirtyDocumentKeys)
    next.add(path)
    this.dirtyDocumentKeys = next
  }

  private deleteDirtyKey(path: DocumentKey): void {
    if (!this.dirtyDocumentKeys.has(path)) return

    const next = new Set(this.dirtyDocumentKeys)
    next.delete(path)
    this.dirtyDocumentKeys = next
  }

  private setContentRevision(documentKey: DocumentKey, contentRevision: string): void {
    this.documentContentRevisions = {
      ...this.documentContentRevisions,
      [documentKey]: contentRevision,
    }
  }

  private commitDeleteProjection(projection: WorkspaceDocumentDeleteProjection): boolean {
    if (!this.isTargetStampCurrent(projection.stamp)) return false
    this.removeLiveDocument(projection.document.key)
    return true
  }

  private rollbackDeleteProjection(projection: WorkspaceDocumentDeleteProjection): boolean {
    if (this.liveDocumentsByKey.has(projection.document.key)) return false

    this.setLiveDocument({
      ...projection.document,
      analysis: createEditorDocumentAnalysis({
        buffer: projection.document.buffer,
        documentId: projection.document.key,
      }),
    })
    if (projection.contentRevision !== undefined) {
      this.setContentRevision(projection.document.key, projection.contentRevision)
    }
    if (projection.dirty) this.addDirtyKey(projection.document.key)
    for (const view of projection.views) {
      this.viewsByTabId.set(view.tabId, { ...view, preparedDocument: null })
    }
    return true
  }

  private setLiveDocument(document: LiveEditorDocument): void {
    const previous = this.liveDocumentsByKey.get(document.key)
    this.liveDocumentsByKey.set(document.key, document)
    if (!previous) {
      this.pathOwnershipRevision += 1
      const resource = filesystemResource(document.target)
      if (resource) this.advancePathOwnership(resource.path)
    }
    this.documentKeysByBuffer.set(document.buffer, document.key)
    if (!this.unsubscribeByBuffer.has(document.buffer)) {
      const unsubscribe = document.buffer.subscribe((event) =>
        this.acceptBufferChange(document.buffer, event),
      )
      this.unsubscribeByBuffer.set(document.buffer, unsubscribe)
    }
    this.refreshLiveComparison(document.key)
    if (previous?.analysis !== document.analysis) this.notifyEditorAnalyses()
    if (previous?.buffer !== document.buffer) this.detachPreviousBuffer(previous)
  }

  private detachPreviousBuffer(document: LiveEditorDocument | undefined): void {
    if (!document) return
    this.preparationPins.delete(document.buffer)
    document.analysis.dispose()
    this.detachBuffer(document.buffer)
  }

  private detachBuffer(buffer: EditorTextBuffer): void {
    this.releaseRecoveryConflict(buffer)
    this.unsubscribeByBuffer.get(buffer)?.()
    this.unsubscribeByBuffer.delete(buffer)
    this.documentKeysByBuffer.delete(buffer)
  }

  private releaseRecoveryConflict(buffer: EditorTextBuffer): void {
    const conflict = this.recoveryConflictByBuffer.get(buffer)
    if (!conflict) return
    releaseDocumentMutationLease(buffer, conflict.lease)
    this.recoveryConflictByBuffer.delete(buffer)
  }

  private acceptBufferChange(buffer: EditorTextBuffer, event: EditorTextBufferChange): void {
    const documentKey = this.documentKeysByBuffer.get(buffer)
    if (!documentKey) return

    const document = this.liveDocumentsByKey.get(documentKey)
    if (!document || document.buffer !== buffer) return

    const localRevision = event.revisionAfter
    if (localRevision <= document.localRevision) return

    if (event.change.kind === 'synchronize') {
      this.liveDocumentsByKey.set(documentKey, { ...document, localRevision })
      this.refreshLiveComparison(documentKey, {
        revision: event.revisionAfter,
        snapshot: event.change.textSnapshot,
      })
      this.onStateChange()
      return
    }

    this.acceptTextRevision(document, localRevision, event.change.isDirty)
    this.refreshLiveComparison(documentKey, {
      revision: event.revisionAfter,
      snapshot: event.change.textSnapshot,
    })
    this.onStateChange()
  }

  private acceptTextRevision(
    document: LiveEditorDocument,
    localRevision: number,
    isDirty = document.buffer.isDirty(),
  ): void {
    this.dirtyContentRevision += 1
    const contentRevision = editedContentRevision(this.dirtyContentRevision)
    this.liveDocumentsByKey.set(document.key, { ...document, contentRevision, localRevision })
    this.setContentRevision(document.key, contentRevision)
    if (isDirty) {
      this.addDirtyKey(document.key)
      return
    }
    this.deleteDirtyKey(document.key)
  }

  private refreshSnapshotComparison(
    lease: SnapshotComparisonLease,
    input: SnapshotComparisonInput,
    request: SnapshotComparisonRefresh,
  ): boolean {
    const entry = this.snapshotInterests.get(lease)
    if (
      !entry?.group ||
      entry.refresh !== request ||
      entry.group.refresh !== request ||
      request.lease !== lease
    )
      return false
    if (
      input.scope.environmentId !== this.environmentId ||
      snapshotGroupKey(input) !== snapshotGroupKey(entry.group.current.input)
    )
      return false
    entry.refresh = null
    entry.group.refresh = null
    this.publishSnapshotInput(entry.group, input)
    this.onStateChange()
    return true
  }

  private publishSnapshotInput(
    group: SnapshotComparisonGroup,
    input: SnapshotComparisonInput,
  ): void {
    group.refresh = null
    const read = { kind: 'ready' as const, input }
    group.current = read
    const reads = new Map(this.snapshotComparisons)
    for (const [interest, member] of group.interests) {
      member.current = read
      reads.set(interest, read)
    }
    this.snapshotComparisons = reads
  }

  private releaseSnapshotComparison(
    lease: SnapshotComparisonLease,
    reason: 'interest-ended' | 'owner-disposed',
  ): void {
    const entry = this.snapshotInterests.get(lease)
    if (!entry?.group) return
    entry.stop()
    const group = entry.group
    if (group.refresh?.lease === lease) group.refresh = null
    group.interests.delete(lease)
    if (group.interests.size === 0)
      this.snapshotGroups.delete(snapshotGroupKey(group.current.input))
    entry.group = null
    entry.refresh = null
    entry.current = { kind: 'released', reason }
    this.snapshotInterests.delete(lease)
    const reads = new Map(this.snapshotComparisons)
    reads.delete(lease)
    this.snapshotComparisons = reads
    const tabs = new Map(this.snapshotComparisonTabs)
    for (const [tabId, interest] of tabs) {
      if (interest === lease) tabs.delete(tabId)
    }
    this.snapshotComparisonTabs = tabs
    if (!this.sourceOwnerDisposed) this.onStateChange()
  }

  private comparisonRead(
    scope: SavedComparisonScope,
    saved: FileSnapshot,
    committed?: { readonly revision: number; readonly snapshot: DocumentTextSnapshot },
  ): Exclude<SavedComparisonRead, { kind: 'released' }> {
    const document = this.liveDocumentsByKey.get(fileDocumentKey(saved.path))
    const savedInput = { kind: 'saved-file' as const, snapshot: saved }
    if (!document) return { kind: 'unavailable', scope, saved: savedInput }
    return {
      kind: 'ready',
      scope,
      saved: savedInput,
      live: {
        kind: 'live-buffer',
        key: document.key,
        buffer: document.buffer,
        analysis: document.analysis,
        revision: committed?.revision ?? document.buffer.getRevision(),
        snapshot: committed?.snapshot ?? document.buffer.getTextSnapshot(),
      },
    }
  }

  private assertComparisonOwner(scope: SavedComparisonScope): void {
    if (scope.environmentId === this.environmentId) return
    throw createClientInvariantError('Comparison source belongs to a different environment', {
      ownerAvailable: this.environmentId !== null,
      environmentMatches: scope.environmentId === this.environmentId,
    })
  }

  private publishComparison(lease: SavedComparisonLease, read: SavedComparisonRead): void {
    this.savedComparisons = new Map(this.savedComparisons).set(lease, read)
  }

  private refreshLiveComparison(
    key: DocumentKey,
    committed?: { readonly revision: number; readonly snapshot: DocumentTextSnapshot },
  ): void {
    for (const [lease, entry] of this.comparisonInterests) {
      if (fileDocumentKey(entry.path) !== key || entry.current.kind === 'released') continue
      entry.current = {
        ...this.comparisonRead(entry.scope, entry.current.saved.snapshot, committed),
        saved: entry.current.saved,
      }
      this.publishComparison(lease, entry.current)
    }
  }

  private refreshSavedComparison(
    lease: SavedComparisonLease,
    snapshot: FileSnapshot,
    request: SavedComparisonRefresh,
  ): boolean {
    const entry = this.comparisonInterests.get(lease)
    if (!entry || entry.savedRefresh !== request || request.lease !== lease) return false
    if (snapshot.path !== entry.path || snapshot.seemsBinary)
      throw createClientInvariantError('Comparison saved input identity changed', {
        pathMatches: snapshot.path === entry.path,
        sourceKind: snapshot.seemsBinary ? 'binary' : 'text',
      })
    if (entry.current.kind === 'released') return false
    entry.savedRefresh = null
    entry.current = { ...entry.current, saved: { kind: 'saved-file', snapshot } }
    this.publishComparison(lease, entry.current)
    this.onStateChange()
    return true
  }

  private requestSavedRefresh(lease: SavedComparisonLease): SavedComparisonRefresh {
    const request = { lease }
    const entry = this.comparisonInterests.get(lease)
    if (entry) entry.savedRefresh = request
    return request
  }

  private releaseSavedComparison(
    lease: SavedComparisonLease,
    reason: 'interest-ended' | 'owner-disposed',
  ): void {
    const entry = this.comparisonInterests.get(lease)
    if (!entry) return
    entry.stop()
    entry.current = { kind: 'released', reason }
    this.comparisonInterests.delete(lease)
    const remaining = new Map(this.savedComparisons)
    remaining.delete(lease)
    this.savedComparisons = remaining
    const tabs = new Map(this.savedComparisonTabs)
    for (const [tabId, owned] of tabs) {
      if (owned === lease) tabs.delete(tabId)
    }
    this.savedComparisonTabs = tabs
    if (!this.sourceOwnerDisposed) this.onStateChange()
  }
}

function editedContentRevision(revision: number) {
  return `e:${revision.toString(36)}`
}

function canonicalReservationRequests(
  requests: readonly WorkspaceDocumentPathReservationRequest[],
): readonly WorkspaceDocumentPathReservationRequest[] | null {
  const byPath = new Map<string, WorkspaceDocumentPathReservationRequest>()
  for (const request of requests) {
    const existing = byPath.get(request.canonicalPath)
    if (existing && !sameReservationRequest(existing, request)) return null
    byPath.set(request.canonicalPath, request)
  }
  return Array.from(byPath.values()).toSorted((left, right) =>
    comparePaths(left.canonicalPath, right.canonicalPath),
  )
}

function sameReservationRequest(
  left: WorkspaceDocumentPathReservationRequest,
  right: WorkspaceDocumentPathReservationRequest,
): boolean {
  return (
    left.expectedDocumentKey === right.expectedDocumentKey &&
    left.expectedPathOwnershipRevision === right.expectedPathOwnershipRevision
  )
}

function uniqueTargetStamps(
  stamps: readonly WorkspaceDocumentTargetStamp[],
): readonly WorkspaceDocumentTargetStamp[] {
  const byBuffer = new Map<EditorTextBuffer, WorkspaceDocumentTargetStamp>()
  for (const stamp of stamps) {
    if (!byBuffer.has(stamp.buffer)) byBuffer.set(stamp.buffer, stamp)
  }
  return Array.from(byBuffer.values()).toSorted((left, right) =>
    comparePaths(left.path, right.path),
  )
}

function releaseMutationLeaseEntries(
  entries: readonly WorkspaceDocumentMutationLeaseEntry[],
): boolean {
  let released = true
  for (const entry of entries.toReversed()) {
    const result = releaseDocumentMutationLease(entry.buffer, entry.lease)
    if (result.status !== 'released') released = false
  }
  return released
}

function releaseRecoveryConflictEntries(
  entries: readonly {
    readonly document: LiveEditorDocument
    readonly entry: WorkspaceDocumentRecoveryConflictEntry
  }[],
): void {
  for (const { document, entry } of entries.toReversed()) {
    releaseDocumentMutationLease(document.buffer, entry.lease)
  }
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function fileSyncVersion(document: LiveEditorDocument | undefined) {
  if (!document) return null
  if (document.sync.kind !== 'file') return null

  return document.sync.fileVersion
}

function cleanClaimForFile(
  claim: PreparedFileOpenClaim | null,
  file: FileSnapshot,
): Extract<PreparedFileOpenClaim, { readonly kind: 'clean' }> | null {
  if (claim?.kind !== 'clean') return null
  if (claim.path !== file.path) return null
  if (claim.fileVersion !== file.version) return null
  if (claim.buffer.isDirty()) return null
  if (claim.buffer.getSnapshot() !== claim.snapshot) return null

  return claim
}

function preparedDocumentForClaim(
  document: LiveEditorDocument,
  claim: PreparedFileOpenClaim | null,
): EditorPreparedDocument | null {
  if (!claim?.preparedDocument) return null
  if (!preparedClaimMatchesDocument(document, claim)) {
    claim.preparedDocument.dispose()
    return null
  }

  return claim.preparedDocument
}

function preparedClaimMatchesDocument(
  document: LiveEditorDocument,
  claim: PreparedFileOpenClaim,
): boolean {
  if (filesystemResource(document.target)?.path !== claim.path) return false
  if (document.buffer !== claim.buffer) return false
  if (document.buffer.getSnapshot() !== claim.snapshot) return false
  if (document.key !== claim.documentKey) return false
  if (document.localRevision !== claim.localRevision) return false
  if (claim.kind === 'live') return true
  if (document.sync.kind !== 'file') return false

  return document.sync.fileVersion === claim.fileVersion
}

function omitKey(
  record: Readonly<Record<string, string>>,
  key: string,
): Readonly<Record<string, string>> {
  if (!(key in record)) return record

  const next = { ...record }
  delete next[key]
  return next
}

/**
 * A Map rendered as a plain record for zustand selectors. Values are passed
 * through untouched — the Map already holds the only representation — and the
 * previous record is reused wholesale when every entry survived, so a
 * high-frequency write (per-frame scroll position) does not invalidate
 * subscribers of unrelated slices.
 */
function recordFromMap<T>(
  source: Map<string, T>,
  previous: Readonly<Record<string, T>> | undefined,
): Readonly<Record<string, T>> {
  let unchanged = previous !== undefined && Object.keys(previous).length === source.size
  const next: Record<string, T> = {}
  for (const [key, value] of source) {
    next[key] = value
    if (previous?.[key] !== value) unchanged = false
  }
  if (unchanged && previous) return previous
  return next
}

export function supportsTextFile(file: FileSnapshot): boolean {
  return !file.seemsBinary && !isPdfFile(file.path)
}

function assertTextFile(file: FileSnapshot): void {
  if (supportsTextFile(file)) return
  if (isPdfFile(file.path)) throw pdfError('TEXT_UNAVAILABLE', file.size, 'registration')
  throw createBinaryFileError(file.size)
}

function snapshotGroupKey(input: SnapshotComparisonInput): string {
  return JSON.stringify([input.scope.rootPath, input.subject])
}
