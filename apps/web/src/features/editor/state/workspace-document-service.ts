import { createClientInvariantError } from '@/lib/structured-errors'

import {
  contentRevisionForText,
  fileContentRevision,
  textSnapshotEqualsText,
} from '@/features/editor/utils/text-snapshot'
import type { PreparedFileOpenClaim } from '@/lib/file-open-intent/types'
import type { SettingsWriteTarget } from '@workspace/contracts'

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

export type SettingsDocumentSync =
  | {
      kind: 'settings'
      revision: string
      state: Exclude<LiveDocumentSyncState, 'conflict'>
      target: SettingsWriteTarget
    }
  | {
      confirmedText: string | null
      kind: 'settings'
      revision: string | null
      state: 'conflict'
      target: SettingsWriteTarget
    }

/**
 * Where a document's contents came from, and therefore where a save sends them.
 *
 * `settings` exists because "can this be saved" and "is this a path on disk" are
 * different questions. A raw settings.json buffer is written through
 * `POST /settings/raw` — the fs routes only take workspace-relative paths, and
 * the settings file is addressed by layer rather than by path — so it is savable
 * without ever being file-backed. Keeping that on the document rather than in a
 * predicate over the id is what stops the save path from growing a second
 * spelling of the same question.
 */
type LiveDocumentSync =
  | {
      fileVersion: string
      kind: 'file'
      mtimeMs: number
      path: string
      state: LiveDocumentSyncState
    }
  | SettingsDocumentSync
  | {
      affectedPaths: readonly string[]
      kind: 'recovery-conflict'
      operationId: string
      path: string
    }
  | {
      kind: 'none'
    }

export type LiveEditorDocument = {
  readonly buffer: EditorTextBuffer
  readonly contentRevision: string
  readonly id: string
  readonly localRevision: number
  readonly path: string
  readonly sync: LiveDocumentSync
}

export type EditorDocumentView = {
  readonly documentId: string
  readonly preparedDocument: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly tabId: string
  readonly view: EditorViewSession
}

export type LiveEditorViewDocument = LiveEditorDocument & {
  readonly preparedDocument: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly tabId: string
  readonly view: EditorViewSession
}

export type WorkspaceDocumentTargetStamp = {
  readonly buffer: EditorTextBuffer
  readonly bufferRevision: number
  readonly contentRevision: string
  readonly dirty: boolean
  readonly documentId: string
  readonly localRevision: number
  readonly path: string
  readonly snapshot: PieceTableSnapshot
  readonly sync: LiveEditorDocument['sync']
}

export type WorkspaceDocumentRenameProjection = {
  readonly from: string
  readonly kind: 'rename'
  readonly reservation: WorkspaceDocumentPathReservation | null
  readonly source: WorkspaceDocumentTargetStamp | null
  readonly to: string
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
  readonly canonicalPath: string
  readonly expectedDocumentId: string | null
  readonly expectedPathOwnershipRevision: number
}

export type WorkspaceDocumentPathReservationResult =
  | { readonly reservation: WorkspaceDocumentPathReservation; readonly status: 'acquired' }
  | { readonly status: 'busy' | 'stale' }

export type ReleaseWorkspaceDocumentPathReservationResult = {
  readonly status: 'already-released' | 'released'
}

export type WorkspaceDocumentMutationLeaseEntry = {
  readonly buffer: EditorTextBuffer
  readonly lease: DocumentMutationLease
  readonly path: string
}

export type WorkspaceDocumentMutationLeaseSet = {
  readonly entries: readonly WorkspaceDocumentMutationLeaseEntry[]
  readonly ownerId: string
}

export type WorkspaceDocumentMutationLeaseResult =
  | { readonly leaseSet: WorkspaceDocumentMutationLeaseSet; readonly status: 'acquired' }
  | { readonly path: string; readonly status: 'busy' | 'stale' }

export type WorkspaceDocumentRecoveryConflictResult =
  | { readonly conflictedPaths: readonly string[]; readonly status: 'acquired' }
  | { readonly path: string; readonly status: 'busy' | 'stale' }

export type WorkspaceDocumentRecoveryLeaseTransfer = {
  readonly operationId: string
}

export type WorkspaceDocumentRecoveryLeaseTransferPreparationResult =
  | {
      readonly status: 'prepared'
      readonly transfer: WorkspaceDocumentRecoveryLeaseTransfer
    }
  | { readonly path: string; readonly status: 'busy' | 'stale' }

type WorkspaceDocumentRecoveryConflictEntry = {
  readonly lease: DocumentMutationLease
  readonly operationId: string
  readonly previousSync: LiveDocumentSync
}

type WorkspaceDocumentRecoveryLeaseTransferData = {
  readonly affectedPaths: readonly string[]
  readonly leaseSet: WorkspaceDocumentMutationLeaseSet
  readonly operationId: string
  readonly retained: readonly {
    readonly document: LiveEditorDocument
    readonly entry: WorkspaceDocumentMutationLeaseEntry
  }[]
}

export type UnsyncedLiveEditorDocumentInput = {
  content: string
  id: string
  /** Omitted for a buffer nothing can write back, such as a conflict snapshot. */
  sync?: Exclude<LiveDocumentSync, { kind: 'file' } | { kind: 'recovery-conflict' }>
}

export type WorkspaceDocumentServiceState = {
  documentContentRevisions: Readonly<Record<string, string>>
  dirtyContentRevision: number
  dirtyFilePaths: ReadonlySet<string>
  liveDocumentsById: Readonly<Record<string, LiveEditorDocument>>
  pathOwnershipRevision: number
  scrollPositionByTabId: Readonly<Record<string, EditorScrollPosition>>
  viewsByTabId: Readonly<Record<string, EditorDocumentView>>
}

export class WorkspaceDocumentService {
  private documentContentRevisions: Readonly<Record<string, string>> = {}
  private dirtyFilePaths: ReadonlySet<string> = new Set()
  private dirtyContentRevision = 0
  private pathOwnershipRevision = 0
  private readonly liveDocumentsById = new Map<string, LiveEditorDocument>()
  private readonly documentIdsByBuffer = new Map<EditorTextBuffer, string>()
  private readonly unsubscribeByBuffer = new Map<EditorTextBuffer, () => void>()
  private readonly recoveryConflictByBuffer = new Map<
    EditorTextBuffer,
    WorkspaceDocumentRecoveryConflictEntry
  >()
  private readonly recoveryLeaseTransfers = new WeakMap<
    WorkspaceDocumentRecoveryLeaseTransfer,
    WorkspaceDocumentRecoveryLeaseTransferData
  >()
  private readonly pathReservations = new Map<string, WorkspaceDocumentPathReservation>()
  private readonly reservedPathsByToken = new WeakMap<
    WorkspaceDocumentPathReservation,
    readonly string[]
  >()
  private readonly ownershipRevisionByPath = new Map<string, number>()
  private readonly viewsByTabId = new Map<string, EditorDocumentView>()
  /**
   * Last known scroll position per document, seeded from the workspace cache.
   * Read when a view is created, so a reopened file (or a refreshed app)
   * lands where it was; updated on every scroll write.
   */
  private readonly scrollPositionSeeds = new Map<string, EditorScrollPosition>()
  private cachedState: WorkspaceDocumentServiceState | null = null

  constructor(private readonly onStateChange: () => void = () => undefined) {}

  /**
   * Retained text size per live document. Every one, not only the evictable: an
   * unevictable document still occupies memory. `length` is a retained field.
   */
  documentSizes(): ReadonlyMap<string, number> {
    const sizes = new Map<string, number>()
    for (const [documentId, document] of this.liveDocumentsById) {
      sizes.set(documentId, document.buffer.getTextSnapshot().length)
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
    documentIds,
    tabIds,
  }: {
    documentIds: ReadonlySet<string>
    tabIds: ReadonlySet<string>
  }): { evictedDocumentIds: string[]; evictedTabIds: string[] } {
    const evictedDocumentIds: string[] = []
    for (const [documentId, document] of this.liveDocumentsById) {
      if (documentIds.has(documentId)) continue
      if (this.isDirtyDocument(documentId)) continue
      if (document.sync.kind !== 'file') continue
      if (!this.pathsAvailable([document.path], null)) continue

      this.deleteLiveDocument(documentId)
      evictedDocumentIds.push(documentId)
    }

    // After the document pass: deleteLiveDocument has already removed the views
    // belonging to evicted documents, so anything left here is a kept document
    // whose tab is simply gone.
    const evictedTabIds: string[] = []
    for (const tabId of this.viewsByTabId.keys()) {
      if (tabIds.has(tabId)) continue

      this.viewsByTabId.get(tabId)?.preparedDocument?.dispose()
      this.viewsByTabId.delete(tabId)
      evictedTabIds.push(tabId)
    }

    return { evictedDocumentIds, evictedTabIds }
  }

  deleteLiveDocument(documentId: string): { hadLiveDocument: boolean; wasDirty: boolean } {
    this.assertPathsAvailable([documentId])
    return this.removeLiveDocument(documentId)
  }

  private removeLiveDocument(documentId: string): {
    hadLiveDocument: boolean
    wasDirty: boolean
  } {
    const document = this.liveDocumentsById.get(documentId)
    const path = document?.path ?? documentId
    const wasDirty = this.isDirtyDocument(documentId)
    const hadLiveDocument = this.liveDocumentsById.delete(documentId)
    if (document) this.detachBuffer(document.buffer)
    if (hadLiveDocument) {
      this.pathOwnershipRevision += 1
      this.advancePathOwnership(path)
    }

    this.deleteDirtyPath(path)
    this.documentContentRevisions = omitKey(this.documentContentRevisions, documentId)

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentId !== documentId) continue

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
    const existing = this.liveDocumentsById.get(file.path)
    const cleanClaim = cleanClaimForFile(claim, file)
    if (existing?.sync.kind === 'recovery-conflict') return existing
    if (existing?.buffer.isDirty()) return existing
    if (existing && fileSyncVersion(existing) === file.version) {
      return existing
    }

    const record = this.createFileDocument(file, cleanClaim)
    this.setLiveDocument(record)
    this.setContentRevision(file.path, record.contentRevision)
    this.deleteDirtyPath(file.path)
    this.rebindViewsForDocument(file.path)
    return record
  }

  ensureView(
    tabId: string,
    file: FileResult,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorViewDocument {
    const document = this.ensureLiveDocument(file, claim)
    return this.ensureViewForDocument(tabId, document.id, claim)
  }

  ensureUnsyncedDocument(input: UnsyncedLiveEditorDocumentInput): LiveEditorDocument {
    const existing = this.liveDocumentsById.get(input.id)
    if (existing?.buffer.isDirty()) return existing
    if (existing && textSnapshotEqualsText(existing.buffer.getTextSnapshot(), input.content)) {
      return existing
    }

    const record = this.createUnsyncedDocument(input)
    this.setLiveDocument(record)
    this.setContentRevision(input.id, record.contentRevision)
    this.rebindViewsForDocument(input.id)
    return record
  }

  ensureViewForDocument(
    tabId: string,
    documentId: string,
    claim: PreparedFileOpenClaim | null = null,
  ): LiveEditorViewDocument {
    this.assertPathsAvailable([documentId])
    const document = this.getRequiredLiveDocument(documentId)
    const existing = this.viewsByTabId.get(tabId)
    if (existing?.documentId === document.id) {
      const preparedDocument = preparedDocumentForClaim(document, claim)
      if (preparedDocument) {
        existing.preparedDocument?.dispose()
        this.viewsByTabId.set(tabId, { ...existing, preparedDocument })
        return this.viewDocumentProjection(this.viewsByTabId.get(tabId)!)
      }
      return this.viewDocumentProjection(existing)
    }

    const scrollPosition = existing?.scrollPosition ?? this.scrollPositionSeeds.get(document.id)
    const view = createEditorViewSession(document.buffer, `tab:${tabId}`)
    view.setScrollPosition(scrollPosition)
    const nextView: EditorDocumentView = {
      documentId: document.id,
      preparedDocument: preparedDocumentForClaim(document, claim),
      scrollPosition,
      tabId,
      view,
    }
    this.viewsByTabId.set(tabId, nextView)

    return this.viewDocumentProjection(nextView)
  }

  removeView(tabId: string): boolean {
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false

    view.preparedDocument?.dispose()
    this.viewsByTabId.delete(tabId)
    return true
  }

  forceReplaceLiveDocument(file: FileResult): { changed: boolean; wasDirty: boolean } {
    this.assertPathsAvailable([file.path])
    const wasDirty = this.isDirtyDocument(file.path)
    const existing = this.liveDocumentsById.get(file.path)
    if (existing && !wasDirty && fileSyncVersion(existing) === file.version) {
      if (textSnapshotEqualsText(existing.buffer.getTextSnapshot(), file.content)) {
        return { changed: false, wasDirty: false }
      }
    }

    const record = this.replacementDocument(file, existing)

    this.setLiveDocument(record)
    this.setContentRevision(file.path, record.contentRevision)
    this.deleteDirtyPath(file.path)
    this.rebindViewsForDocument(file.path)
    return { changed: true, wasDirty }
  }

  getLiveDocument(documentId: string): LiveEditorDocument | null {
    return this.liveDocumentsById.get(documentId) ?? null
  }

  getView(tabId: string): EditorDocumentView | null {
    return this.viewsByTabId.get(tabId) ?? null
  }

  getViewDocument(tabId: string): LiveEditorViewDocument | null {
    const record = this.viewsByTabId.get(tabId)
    if (!record) return null

    return this.viewDocumentProjection(record)
  }

  prepareTargetStamp(documentId: string): WorkspaceDocumentTargetStamp | null {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return null

    return {
      buffer: document.buffer,
      bufferRevision: document.buffer.getRevision(),
      contentRevision: document.contentRevision,
      dirty: this.isDirtyDocument(documentId),
      documentId,
      localRevision: document.localRevision,
      path: document.path,
      snapshot: document.buffer.getSnapshot(),
      sync: document.sync,
    }
  }

  isTargetStampCurrent(stamp: WorkspaceDocumentTargetStamp): boolean {
    const document = this.liveDocumentsById.get(stamp.documentId)
    if (!document) return false
    if (document.buffer !== stamp.buffer) return false
    if (document.buffer.getRevision() !== stamp.bufferRevision) return false
    if (document.buffer.getSnapshot() !== stamp.snapshot) return false
    if (document.localRevision !== stamp.localRevision) return false
    if (document.contentRevision !== stamp.contentRevision) return false
    if (document.path !== stamp.path || document.sync !== stamp.sync) return false
    return this.isDirtyDocument(stamp.documentId) === stamp.dirty
  }

  preparePathReservation(path: string): WorkspaceDocumentPathReservationRequest {
    return {
      canonicalPath: path,
      expectedDocumentId: this.liveDocumentsById.has(path) ? path : null,
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
    affectedPaths: readonly string[],
  ): WorkspaceDocumentMutationLeaseSet {
    const affected = new Set(affectedPaths)
    const retained: WorkspaceDocumentMutationLeaseEntry[] = []
    for (const entry of leaseSet.entries) {
      const documentId = this.documentIdsByBuffer.get(entry.buffer)
      const document = documentId ? this.liveDocumentsById.get(documentId) : null
      if (document && affected.has(document.path)) {
        retained.push({ ...entry, path: document.path })
        continue
      }
      releaseDocumentMutationLease(entry.buffer, entry.lease)
    }
    return Object.freeze({ entries: Object.freeze(retained), ownerId: leaseSet.ownerId })
  }

  prepareMutationLeaseRecoveryConflictTransfer(
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly string[],
    operationId: string,
  ): WorkspaceDocumentRecoveryLeaseTransferPreparationResult {
    const paths = Array.from(new Set(affectedPaths)).sort()
    const affected = new Set(paths)
    const retained = leaseSet.entries.flatMap((entry) => {
      const documentId = this.documentIdsByBuffer.get(entry.buffer)
      const document = documentId ? this.liveDocumentsById.get(documentId) : null
      if (!document || !affected.has(document.path)) return []
      return [{ document, entry }]
    })
    for (const { document } of retained) {
      if (!this.recoveryConflictByBuffer.has(document.buffer)) continue
      return { path: document.path, status: 'busy' }
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
  ): readonly string[] {
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
          path: document.path,
        },
      })
    }
    return prepared.retained.map(({ document }) => document.path)
  }

  markRecoveryConflict(
    affectedPaths: readonly string[],
    operationId: string,
  ): WorkspaceDocumentRecoveryConflictResult {
    const paths = Array.from(new Set(affectedPaths)).sort()
    const documents = paths.flatMap((path) => {
      const document = this.liveDocumentsById.get(path)
      return document ? [document] : []
    })
    const acquired: Array<{
      document: LiveEditorDocument
      entry: WorkspaceDocumentRecoveryConflictEntry
    }> = []

    for (const document of documents) {
      const existing = this.recoveryConflictByBuffer.get(document.buffer)
      if (existing?.operationId === operationId) continue
      if (existing) {
        releaseRecoveryConflictEntries(acquired)
        return { path: document.path, status: 'busy' }
      }

      const result = acquireDocumentMutationLease(
        document.buffer,
        document.buffer.getRevision(),
        document.buffer.getSnapshot(),
        `workspace-recovery:${operationId}`,
      )
      if (result.status !== 'acquired') {
        releaseRecoveryConflictEntries(acquired)
        return { path: document.path, status: result.status }
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
          path: document.path,
        },
      })
    }
    return {
      conflictedPaths: documents.map((document) => document.path),
      status: 'acquired',
    }
  }

  clearRecoveryConflict(operationId: string): readonly string[] {
    const cleared: string[] = []
    for (const [buffer, entry] of this.recoveryConflictByBuffer) {
      if (entry.operationId !== operationId) continue
      const documentId = this.documentIdsByBuffer.get(buffer)
      const document = documentId ? this.liveDocumentsById.get(documentId) : null
      releaseDocumentMutationLease(buffer, entry.lease)
      this.recoveryConflictByBuffer.delete(buffer)
      if (!document || document.sync.kind !== 'recovery-conflict') continue
      if (document.sync.operationId !== operationId) continue
      this.setLiveDocument({ ...document, sync: entry.previousSync })
      cleared.push(document.path)
    }
    return cleared
  }

  prepareRenameProjection(
    from: string,
    to: string,
    reservation: WorkspaceDocumentPathReservation | null = null,
  ): WorkspaceDocumentRenameProjection | null {
    if (!this.pathsAvailable([from, to], reservation)) return null
    if (from === to) return { from, kind: 'rename', reservation, source: null, to }
    if (this.liveDocumentsById.has(to)) return null

    return { from, kind: 'rename', reservation, source: this.prepareTargetStamp(from), to }
  }

  prepareDeleteProjection(
    path: string,
    reservation: WorkspaceDocumentPathReservation | null = null,
  ): WorkspaceDocumentDeleteProjection | null {
    if (!this.pathsAvailable([path], reservation)) return null
    const document = this.liveDocumentsById.get(path)
    const stamp = this.prepareTargetStamp(path)
    if (!document || !stamp) return null

    const views = Array.from(this.viewsByTabId.values()).filter(
      (view) => view.documentId === document.id,
    )
    return {
      contentRevision: this.documentContentRevisions[document.id],
      dirty: this.isDirtyDocument(document.id),
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
    if (this.liveDocumentsById.has(projection.to)) return false

    this.renameLiveDocumentForOwner(projection.from, projection.to)
    return true
  }

  rollbackProjection(projection: WorkspaceDocumentProjection): boolean {
    if (!this.projectionPathsAvailable(projection)) return false
    if (projection.kind === 'delete') return this.rollbackDeleteProjection(projection)
    if (!projection.source) return true
    if (this.liveDocumentsById.has(projection.from)) return false

    const current = this.liveDocumentsById.get(projection.to)
    if (current?.buffer !== projection.source.buffer) return false
    this.renameLiveDocumentForOwner(projection.to, projection.from)
    return true
  }

  hasLiveDocument(documentId: string): boolean {
    return this.liveDocumentsById.has(documentId)
  }

  markSaved({
    fileVersion,
    documentId,
    mtimeMs,
    savedContentRevision,
    savedText,
  }: {
    fileVersion: string
    documentId: string
    mtimeMs: number
    savedContentRevision: string
    savedText: string
  }): boolean {
    const document = this.liveDocumentsById.get(documentId)
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
    documentId,
    revision,
    savedContentRevision,
    savedText,
  }: {
    documentId: string
    revision: string
    savedContentRevision: string
    savedText: string
  }): boolean {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false

    return this.applySaved(
      document,
      { kind: 'settings', revision, state: 'idle', target: document.sync.target },
      savedContentRevision,
      savedText,
    )
  }

  markSettingsConflict(
    documentId: string,
    confirmedText: string | null,
    revision: string | null,
  ): boolean {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false

    this.setLiveDocument({
      ...document,
      sync: {
        confirmedText,
        kind: 'settings',
        revision,
        state: 'conflict',
        target: document.sync.target,
      },
    })
    return true
  }

  reloadSettingsDocument(documentId: string): boolean {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return false
    if (document.sync.kind !== 'settings' || document.sync.state !== 'conflict') return false
    if (document.sync.confirmedText === null || document.sync.revision === null) return false

    const { confirmedText, revision, target } = document.sync
    const buffer = createEditorTextBuffer(confirmedText)
    buffer.markClean()
    const contentRevision = contentRevisionForText(confirmedText)
    this.setLiveDocument({
      ...document,
      buffer,
      contentRevision,
      localRevision: buffer.getRevision(),
      sync: { kind: 'settings', revision, state: 'idle', target },
    })
    this.setContentRevision(documentId, contentRevision)
    this.deleteDirtyPath(document.path)
    this.rebindViewsForDocument(documentId)
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
  replaceUnsyncedDocumentText(documentId: string, text: string): boolean {
    const document = this.liveDocumentsById.get(documentId)
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
    this.setContentRevision(documentId, contentRevision)
    this.deleteDirtyPath(document.path)
    this.rebindViewsForDocument(documentId)
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
  reconcileSettingsDocument(documentId: string, text: string, revision: string): boolean {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return false
    if (document.sync.kind !== 'settings') return false
    if (document.sync.revision === revision) return false
    if (document.sync.state === 'conflict') {
      return this.markSettingsConflict(documentId, text, revision)
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
      sync: { kind: 'settings', revision, state: 'idle', target: document.sync.target },
    })
    this.setContentRevision(documentId, contentRevision)
    this.deleteDirtyPath(document.path)
    this.rebindViewsForDocument(documentId)
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
    this.setContentRevision(document.id, cleanContentRevision)
    this.deleteDirtyPath(document.path)
    return true
  }

  renameLiveDocument(from: string, to: string): { wasDirty: boolean } {
    this.assertPathsAvailable([from, to])
    const source = this.liveDocumentsById.get(from)
    if (source?.sync.kind === 'recovery-conflict') {
      throw createClientInvariantError('Recovery-conflicted documents cannot be renamed')
    }
    return this.renameLiveDocumentForOwner(from, to)
  }

  private renameLiveDocumentForOwner(from: string, to: string): { wasDirty: boolean } {
    const wasDirty = this.isDirtyDocument(from)
    const document = this.liveDocumentsById.get(from)
    const contentRevision = this.documentContentRevisions[from]

    this.liveDocumentsById.delete(from)
    this.documentContentRevisions = omitKey(this.documentContentRevisions, from)
    this.renameDirtyPath(from, to)

    if (contentRevision !== undefined) this.setContentRevision(to, contentRevision)
    if (document) {
      const renamed = {
        ...document,
        id: to,
        path: to,
        sync: document.sync.kind === 'file' ? { ...document.sync, path: to } : document.sync,
      }
      this.liveDocumentsById.set(to, renamed)
      this.documentIdsByBuffer.set(document.buffer, to)
      this.pathOwnershipRevision += 1
      this.advancePathOwnership(from)
      this.advancePathOwnership(to)
    }

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentId !== from) continue

      view.preparedDocument?.dispose()
      this.viewsByTabId.set(tabId, { ...view, documentId: to, preparedDocument: null })
    }

    return { wasDirty }
  }

  setDirty(documentId: string, dirty: boolean): void {
    const path = this.liveDocumentsById.get(documentId)?.path ?? documentId
    if (dirty) {
      this.addDirtyPath(path)
      return
    }

    this.deleteDirtyPath(path)
  }

  setViewScrollPosition(tabId: string, scrollPosition: EditorScrollPosition): boolean {
    const view = this.viewsByTabId.get(tabId)
    if (!view) return false
    if (scrollPositionsEqual(view.scrollPosition, scrollPosition)) return false

    this.viewsByTabId.set(tabId, { ...view, scrollPosition })
    this.scrollPositionSeeds.set(view.documentId, scrollPosition)
    view.view.setScrollPosition(scrollPosition)
    return true
  }

  seedScrollPositions(byPath: Readonly<Record<string, EditorScrollPosition>>): void {
    this.scrollPositionSeeds.clear()
    for (const [path, scrollPosition] of Object.entries(byPath)) {
      this.scrollPositionSeeds.set(path, scrollPosition)
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
      dirtyFilePaths: this.dirtyFilePaths,
      liveDocumentsById: recordFromMap(this.liveDocumentsById, previous?.liveDocumentsById),
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
    viewsByTabId: Readonly<Record<string, EditorDocumentView>>,
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
    buffer.markClean()

    return {
      buffer,
      contentRevision: fileContentRevision(file.version),
      id: file.path,
      localRevision: buffer.getRevision(),
      path: file.path,
      sync: {
        fileVersion: file.version,
        kind: 'file',
        mtimeMs: file.mtimeMs,
        path: file.path,
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
      id: input.id,
      localRevision: buffer.getRevision(),
      path: input.id,
      sync: input.sync ?? { kind: 'none' },
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
        path: file.path,
        state: 'idle',
      },
    }
  }

  private rebindViewsForDocument(documentId: string): void {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return

    for (const [tabId, view] of this.viewsByTabId) {
      if (view.documentId !== documentId) continue

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
    const document = this.getRequiredLiveDocument(view.documentId)

    return {
      ...document,
      preparedDocument: view.preparedDocument,
      scrollPosition: view.scrollPosition,
      tabId: view.tabId,
      view: view.view,
    }
  }

  private getRequiredLiveDocument(documentId: string): LiveEditorDocument {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) {
      throw createClientInvariantError(`Missing live document ${documentId}`)
    }

    return document
  }

  isDirtyDocument(documentId: string): boolean {
    const document = this.liveDocumentsById.get(documentId)
    if (!document) return this.dirtyFilePaths.has(documentId)
    if (this.dirtyFilePaths.has(document.path)) return true

    return document.buffer.isDirty()
  }

  private projectionPathsAvailable(projection: WorkspaceDocumentProjection): boolean {
    if (projection.kind === 'delete') {
      return this.pathsAvailable([projection.document.path], projection.reservation)
    }
    return this.pathsAvailable([projection.from, projection.to], projection.reservation)
  }

  private pathsAvailable(
    paths: readonly string[],
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

  private assertPathsAvailable(paths: readonly string[]): void {
    if (this.pathsAvailable(paths, null)) return
    throw createClientInvariantError('Workspace document path is reserved by another mutation')
  }

  private pathReservationRequestIsCurrent(
    request: WorkspaceDocumentPathReservationRequest,
  ): boolean {
    const documentId = this.liveDocumentsById.has(request.canonicalPath)
      ? request.canonicalPath
      : null
    if (documentId !== request.expectedDocumentId) return false
    return (
      this.pathOwnershipRevisionFor(request.canonicalPath) === request.expectedPathOwnershipRevision
    )
  }

  private pathOwnershipRevisionFor(path: string): number {
    return this.ownershipRevisionByPath.get(path) ?? 0
  }

  private advancePathOwnership(path: string): void {
    this.ownershipRevisionByPath.set(path, this.pathOwnershipRevisionFor(path) + 1)
  }

  private renameDirtyPath(from: string, to: string): void {
    if (!this.dirtyFilePaths.has(from)) return

    const next = new Set(this.dirtyFilePaths)
    next.delete(from)
    next.add(to)
    this.dirtyFilePaths = next
  }

  private addDirtyPath(path: string): void {
    if (this.dirtyFilePaths.has(path)) return

    const next = new Set(this.dirtyFilePaths)
    next.add(path)
    this.dirtyFilePaths = next
  }

  private deleteDirtyPath(path: string): void {
    if (!this.dirtyFilePaths.has(path)) return

    const next = new Set(this.dirtyFilePaths)
    next.delete(path)
    this.dirtyFilePaths = next
  }

  private setContentRevision(documentId: string, contentRevision: string): void {
    this.documentContentRevisions = {
      ...this.documentContentRevisions,
      [documentId]: contentRevision,
    }
  }

  private commitDeleteProjection(projection: WorkspaceDocumentDeleteProjection): boolean {
    if (!this.isTargetStampCurrent(projection.stamp)) return false
    this.removeLiveDocument(projection.document.id)
    return true
  }

  private rollbackDeleteProjection(projection: WorkspaceDocumentDeleteProjection): boolean {
    if (this.liveDocumentsById.has(projection.document.id)) return false

    this.setLiveDocument(projection.document)
    if (projection.contentRevision !== undefined) {
      this.setContentRevision(projection.document.id, projection.contentRevision)
    }
    if (projection.dirty) this.addDirtyPath(projection.document.path)
    for (const view of projection.views) {
      this.viewsByTabId.set(view.tabId, { ...view, preparedDocument: null })
    }
    return true
  }

  private setLiveDocument(document: LiveEditorDocument): void {
    const previous = this.liveDocumentsById.get(document.id)
    if (previous?.buffer !== document.buffer) this.detachPreviousBuffer(previous)

    this.liveDocumentsById.set(document.id, document)
    if (!previous) {
      this.pathOwnershipRevision += 1
      this.advancePathOwnership(document.path)
    }
    this.documentIdsByBuffer.set(document.buffer, document.id)
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
    this.documentIdsByBuffer.delete(buffer)
  }

  private releaseRecoveryConflict(buffer: EditorTextBuffer): void {
    const conflict = this.recoveryConflictByBuffer.get(buffer)
    if (!conflict) return
    releaseDocumentMutationLease(buffer, conflict.lease)
    this.recoveryConflictByBuffer.delete(buffer)
  }

  private acceptBufferChange(buffer: EditorTextBuffer, event: EditorTextBufferChange): void {
    const documentId = this.documentIdsByBuffer.get(buffer)
    if (!documentId) return

    const document = this.liveDocumentsById.get(documentId)
    if (!document || document.buffer !== buffer) return

    const localRevision = buffer.getRevision()
    if (localRevision <= document.localRevision) return

    if (event.change.kind === 'synchronize') {
      this.liveDocumentsById.set(documentId, { ...document, localRevision })
      this.onStateChange()
      return
    }

    this.acceptTextRevision(document, localRevision)
    this.onStateChange()
  }

  private acceptTextRevision(document: LiveEditorDocument, localRevision: number): void {
    this.dirtyContentRevision += 1
    const contentRevision = editedContentRevision(this.dirtyContentRevision)
    this.liveDocumentsById.set(document.id, { ...document, contentRevision, localRevision })
    this.setContentRevision(document.id, contentRevision)
    if (document.buffer.isDirty()) {
      this.addDirtyPath(document.path)
      return
    }
    this.deleteDirtyPath(document.path)
  }
}

function markEditorOpenBenchmark(name: string, path: string): void {
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
    left.expectedDocumentId === right.expectedDocumentId &&
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
  if (document.path !== claim.path) return false
  if (document.buffer !== claim.buffer) return false
  if (document.buffer.getSnapshot() !== claim.snapshot) return false
  if (claim.kind === 'live') {
    if (document.id !== claim.documentId) return false
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
