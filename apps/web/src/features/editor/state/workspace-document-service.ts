import { createClientInvariantError } from '@/lib/structured-errors'

import {
  contentRevisionForText,
  fileContentRevision,
  textSnapshotEqualsText,
} from '@/features/editor/utils/text-snapshot'
import type { PreparedFileOpenClaim } from '@/lib/file-open-intent/types'
import { documentKey, fileDocument, fileDocumentKey } from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import { tabDocuments } from '@/lib/documents/utils/tabs'
import type {
  DocumentKey,
  DocumentRef,
  FilesystemPath,
  ReopenScrollPosition,
  SettingsDocumentRef,
  TabId,
  UnsyncedDocumentRef,
} from '@/lib/documents/utils/types'

import type { FileResult } from '@/lib/file-system-types'
import {
  createEditorTextBuffer,
  createEditorViewSession,
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  type DocumentMutationLease,
  type EditorScrollPosition,
  type EditorTextBuffer,
  type EditorTextBufferChange,
  type EditorViewSession,
  type PieceTableSnapshot,
  type EditorPreparedDocument,
} from '@singapor/core'

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
  readonly buffer: EditorTextBuffer
  readonly contentRevision: string
  readonly key: DocumentKey
  readonly localRevision: number
  readonly target: DocumentRef
  readonly sync: LiveDocumentSync
}

export type EditorDocumentView = {
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

export type WorkspaceDocumentServiceState = {
  documentContentRevisions: Readonly<Record<DocumentKey, string>>
  dirtyContentRevision: number
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  liveDocumentsByKey: Readonly<Record<DocumentKey, LiveEditorDocument>>
  pathOwnershipRevision: number
  scrollPositionByTabId: Readonly<Record<TabId, EditorScrollPosition>>
  viewsByTabId: Readonly<Record<TabId, EditorDocumentView>>
}

export class WorkspaceDocumentService {
  private documentContentRevisions: Readonly<Record<DocumentKey, string>> = {}
  private dirtyDocumentKeys: ReadonlySet<DocumentKey> = new Set()
  private dirtyContentRevision = 0
  private pathOwnershipRevision = 0
  private readonly liveDocumentsByKey = new Map<DocumentKey, LiveEditorDocument>()
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
  private readonly scrollPositionSeeds = new Map<DocumentKey, EditorScrollPosition>()
  private cachedState: WorkspaceDocumentServiceState | null = null

  constructor(private readonly onStateChange: () => void = () => undefined) {}

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
    if (this.isDirtyDocument(documentKey)) return true
    if (document.sync.kind !== 'file') return true

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
    if (document) this.detachBuffer(document.buffer)
    if (hadLiveDocument) {
      this.pathOwnershipRevision += 1
      if (resource) this.advancePathOwnership(resource.path)
    }

    this.deleteDirtyKey(documentKey)
    this.documentContentRevisions = omitKey(this.documentContentRevisions, documentKey)

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentKey !== documentKey) continue

      view.preparedDocument?.dispose()
      this.viewsByTabId.delete(tabId)
    }

    return { hadLiveDocument, wasDirty }
  }

  ensureLiveDocument(
    file: FileResult,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorDocument {
    this.assertPathsAvailable([file.path])
    const existing = this.liveDocumentsByKey.get(fileDocumentKey(file.path))
    const cleanClaim = cleanClaimForFile(claim, file)
    if (existing?.sync.kind === 'recovery-conflict') return existing
    if (existing?.buffer.isDirty()) return existing
    if (existing && fileSyncVersion(existing) === file.version) {
      return existing
    }

    const record = this.createFileDocument(file, cleanClaim)
    this.setLiveDocument(record)
    this.setContentRevision(record.key, record.contentRevision)
    this.deleteDirtyKey(record.key)
    this.rebindViewsForDocument(record.key)
    return record
  }

  ensureView(
    tabId: TabId,
    file: FileResult,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorViewDocument {
    const document = this.ensureLiveDocument(file, claim)
    return this.ensureViewForDocument(tabId, document.key, claim)
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
    const buffer = createEditorTextBuffer(snapshot.content)
    buffer.markClean()
    const record: LiveEditorDocument = {
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

    const scrollPosition = existing?.scrollPosition ?? this.scrollPositionSeeds.get(document.key)
    const view = createEditorViewSession(document.buffer, `tab:${tabId}`)
    view.setScrollPosition(scrollPosition)
    const nextView: EditorDocumentView = {
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
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false

    view.preparedDocument?.dispose()
    this.viewsByTabId.delete(tabId)
    return true
  }

  forceReplaceLiveDocument(file: FileResult): { changed: boolean; wasDirty: boolean } {
    this.assertPathsAvailable([file.path])
    const wasDirty = this.isDirtyDocument(fileDocumentKey(file.path))
    const existing = this.liveDocumentsByKey.get(fileDocumentKey(file.path))
    if (existing && !wasDirty && fileSyncVersion(existing) === file.version) {
      if (textSnapshotEqualsText(existing.buffer.getTextSnapshot(), file.content)) {
        return { changed: false, wasDirty: false }
      }
    }

    const record = this.replacementDocument(file, existing)

    this.setLiveDocument(record)
    this.setContentRevision(record.key, record.contentRevision)
    this.deleteDirtyKey(record.key)
    this.rebindViewsForDocument(record.key)
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
      { ...document.sync, fileVersion, mtimeMs, state: 'idle' },
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
    const buffer = createEditorTextBuffer(confirmedText)
    buffer.markClean()
    const contentRevision = contentRevisionForText(confirmedText)
    this.setLiveDocument({
      ...document,
      buffer,
      contentRevision,
      localRevision: buffer.getRevision(),
      sync: { kind: 'settings', revision, state: 'idle' },
    })
    this.setContentRevision(documentKey, contentRevision)
    this.deleteDirtyKey(document.key)
    this.rebindViewsForDocument(documentKey)
    return true
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

    const buffer = createEditorTextBuffer(text)
    buffer.markClean()
    const contentRevision = contentRevisionForText(text)
    this.setLiveDocument({
      ...document,
      buffer,
      contentRevision,
      localRevision: buffer.getRevision(),
    })
    // The map mirrors the record; every other writer keeps them together, and a
    // consumer that reads the map to decide whether the text moved would
    // otherwise never notice this one.
    this.setContentRevision(documentKey, contentRevision)
    this.deleteDirtyKey(document.key)
    this.rebindViewsForDocument(documentKey)
    return true
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

    const buffer = createEditorTextBuffer(text)
    buffer.markClean()
    const contentRevision = contentRevisionForText(text)
    this.setLiveDocument({
      ...document,
      buffer,
      contentRevision,
      localRevision: buffer.getRevision(),
      sync: { kind: 'settings', revision, state: 'idle' },
    })
    this.setContentRevision(documentKey, contentRevision)
    this.deleteDirtyKey(document.key)
    this.rebindViewsForDocument(documentKey)
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
      this.pathOwnershipRevision += 1
      this.advancePathOwnership(from)
      this.advancePathOwnership(to)
    }

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentKey !== fromKey) continue

      view.preparedDocument?.dispose()
      this.viewsByTabId.set(tabId, { ...view, documentKey: toKey, preparedDocument: null })
    }

    return { wasDirty }
  }

  setDirty(documentKey: DocumentKey, dirty: boolean): void {
    if (dirty) {
      this.addDirtyKey(documentKey)
      return
    }

    this.deleteDirtyKey(documentKey)
  }

  setViewScrollPosition(tabId: TabId, scrollPosition: EditorScrollPosition): boolean {
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false
    if (scrollPositionsEqual(view.scrollPosition, scrollPosition)) return false

    this.viewsByTabId.set(tabId, { ...view, scrollPosition })
    this.scrollPositionSeeds.set(view.documentKey, scrollPosition)
    view.view.setScrollPosition(scrollPosition)
    return true
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
    file: FileResult,
    claim: Extract<PreparedFileOpenClaim, { readonly kind: 'clean' }> | null = null,
  ): LiveEditorDocument {
    if (!claim) markEditorOpenBenchmark('editor.file_open.buffer_built', file.path)
    const buffer = claim?.buffer ?? createEditorTextBuffer(file.content)
    const target = fileDocument({ path: file.path })
    buffer.markClean()

    return {
      buffer,
      contentRevision: fileContentRevision(file.version),
      key: documentKey(target),
      localRevision: buffer.getRevision(),
      target,
      sync: {
        fileVersion: file.version,
        kind: 'file',
        mtimeMs: file.mtimeMs,
        state: 'idle',
      },
    }
  }

  private createUnsyncedDocument(input: UnsyncedLiveEditorDocumentInput): LiveEditorDocument {
    const buffer = createEditorTextBuffer(input.content)
    buffer.markClean()

    return {
      buffer,
      contentRevision: contentRevisionForText(input.content),
      key: documentKey(input.target),
      localRevision: buffer.getRevision(),
      target: input.target,
      sync: { kind: 'none' },
    }
  }

  private replacementDocument(
    file: FileResult,
    existing: LiveEditorDocument | undefined,
  ): LiveEditorDocument {
    if (!existing) return this.createFileDocument(file)
    if (!textSnapshotEqualsText(existing.buffer.getTextSnapshot(), file.content)) {
      return this.createFileDocument(file)
    }

    existing.buffer.markClean()
    return {
      ...existing,
      contentRevision: fileContentRevision(file.version),
      localRevision: existing.buffer.getRevision(),
      sync: {
        fileVersion: file.version,
        kind: 'file',
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

    this.setLiveDocument(projection.document)
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
    if (previous?.buffer !== document.buffer) this.detachPreviousBuffer(previous)

    this.liveDocumentsByKey.set(document.key, document)
    if (!previous) {
      this.pathOwnershipRevision += 1
      const resource = filesystemResource(document.target)
      if (resource) this.advancePathOwnership(resource.path)
    }
    this.documentKeysByBuffer.set(document.buffer, document.key)
    if (this.unsubscribeByBuffer.has(document.buffer)) return

    const unsubscribe = document.buffer.subscribe((event) =>
      this.acceptBufferChange(document.buffer, event),
    )
    this.unsubscribeByBuffer.set(document.buffer, unsubscribe)
  }

  private detachPreviousBuffer(document: LiveEditorDocument | undefined): void {
    if (!document) return
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

    const localRevision = buffer.getRevision()
    if (localRevision <= document.localRevision) return

    if (event.change.kind === 'synchronize') {
      this.liveDocumentsByKey.set(documentKey, { ...document, localRevision })
      this.onStateChange()
      return
    }

    this.acceptTextRevision(document, localRevision)
    this.onStateChange()
  }

  private acceptTextRevision(document: LiveEditorDocument, localRevision: number): void {
    this.dirtyContentRevision += 1
    const contentRevision = editedContentRevision(this.dirtyContentRevision)
    this.liveDocumentsByKey.set(document.key, { ...document, contentRevision, localRevision })
    this.setContentRevision(document.key, contentRevision)
    if (document.buffer.isDirty()) {
      this.addDirtyKey(document.key)
      return
    }
    this.deleteDirtyKey(document.key)
  }
}

function markEditorOpenBenchmark(name: string, path: FilesystemPath): void {
  const traceGlobal = globalThis as typeof globalThis & { readonly __editorPerfTrace?: unknown }
  if (!traceGlobal.__editorPerfTrace) return

  globalThis.performance?.mark(name, { detail: { path } })
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

function scrollPositionsEqual(
  current: EditorScrollPosition | undefined,
  next: EditorScrollPosition,
) {
  if (!current) return false

  return current.left === next.left && current.top === next.top
}

function fileSyncVersion(document: LiveEditorDocument | undefined) {
  if (!document) return null
  if (document.sync.kind !== 'file') return null

  return document.sync.fileVersion
}

function cleanClaimForFile(
  claim: PreparedFileOpenClaim | null,
  file: FileResult,
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
  if (claim.kind === 'live') {
    if (document.key !== claim.documentKey) return false
    return document.localRevision === claim.localRevision
  }
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
