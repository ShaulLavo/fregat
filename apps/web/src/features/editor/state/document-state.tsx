import { clientErrors } from '@/lib/structured-errors'
import type { FileResult } from '@/lib/file-system-types'
import { type EditorScrollPosition } from '@singapor/core'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla'
import type { DocumentRetention } from '@/features/editor/utils/document-retention'
import type { PreparedFileOpenClaim } from '@/lib/file-open-intent/types'
import {
  WorkspaceDocumentService,
  type EditorDocumentView,
  type LiveEditorDocument,
  type LiveEditorViewDocument,
  type UnsyncedLiveEditorDocumentInput,
  type WorkspaceDocumentServiceState,
  type WorkspaceDocumentDeleteProjection,
  type WorkspaceDocumentProjection,
  type WorkspaceDocumentMutationLeaseResult,
  type WorkspaceDocumentMutationLeaseSet,
  type WorkspaceDocumentRecoveryConflictResult,
  type WorkspaceDocumentRecoveryLeaseTransfer,
  type WorkspaceDocumentRecoveryLeaseTransferPreparationResult,
  type WorkspaceDocumentPathReservation,
  type WorkspaceDocumentPathReservationRequest,
  type WorkspaceDocumentPathReservationResult,
  type ReleaseWorkspaceDocumentPathReservationResult,
  type WorkspaceDocumentRenameProjection,
  type WorkspaceDocumentTargetStamp,
} from '@/features/editor/state/workspace-document-service'

export type { LiveEditorDocument, UnsyncedLiveEditorDocumentInput }

type DeleteLiveEditorDocumentResult = {
  hadLiveDocument: boolean
  wasDirty: boolean
}

type CreateEditorDocumentStoreOptions = {
  /** Scroll positions restored from the workspace cache, keyed by document path. */
  scrollPositionSeeds?: Readonly<Record<string, EditorScrollPosition>>
}

type EditorDocumentStoreActions = {
  deleteLiveEditorDocument: (documentId: string) => DeleteLiveEditorDocumentResult
  ensureEditorView: (
    tabId: string,
    file: FileResult,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorViewDocument
  ensureEditorViewForDocument: (
    tabId: string,
    documentId: string,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorViewDocument
  ensureLiveEditorDocument: (
    file: FileResult,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorDocument
  ensureUnsyncedEditorDocument: (input: UnsyncedLiveEditorDocumentInput) => LiveEditorDocument
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  getEditorView: (tabId: string) => EditorDocumentView | null
  /** Retained text size per live document; the only input to the retention budget. */
  editorDocumentSizes: () => ReadonlyMap<string, number>
  getLiveEditorDocument: (documentId: string) => LiveEditorDocument | null
  hasLiveEditorDocument: (documentId: string) => boolean
  markLiveEditorDocumentSaved: (input: {
    documentId: string
    fileVersion: string
    mtimeMs: number
    savedContentRevision: string
    savedText: string
  }) => boolean
  markSettingsDocumentSaved: (input: {
    documentId: string
    revision: string
    savedContentRevision: string
    savedText: string
  }) => boolean
  markSettingsDocumentConflict: (
    documentId: string,
    confirmedText: string | null,
    revision: string | null,
  ) => boolean
  reloadSettingsDocument: (documentId: string) => boolean
  /** Re-seeds a synthetic buffer from text the server rewrote; see the service. */
  replaceUnsyncedEditorDocumentText: (documentId: string, text: string) => boolean
  /** Brings a clean settings buffer back in step with the file; see the service. */
  reconcileSettingsDocument: (documentId: string, text: string, revision: string) => boolean
  prepareWorkspaceDocumentTarget: (documentId: string) => WorkspaceDocumentTargetStamp | null
  isWorkspaceDocumentTargetCurrent: (stamp: WorkspaceDocumentTargetStamp) => boolean
  prepareWorkspaceDocumentDelete: (
    path: string,
    reservation?: WorkspaceDocumentPathReservation | null,
  ) => WorkspaceDocumentDeleteProjection | null
  prepareWorkspaceDocumentRename: (
    from: string,
    to: string,
    reservation?: WorkspaceDocumentPathReservation | null,
  ) => WorkspaceDocumentRenameProjection | null
  prepareWorkspaceDocumentPathReservation: (path: string) => WorkspaceDocumentPathReservationRequest
  reserveWorkspaceDocumentPaths: (
    requests: readonly WorkspaceDocumentPathReservationRequest[],
    ownerId: string,
  ) => WorkspaceDocumentPathReservationResult
  releaseWorkspaceDocumentPaths: (
    reservation: WorkspaceDocumentPathReservation,
  ) => ReleaseWorkspaceDocumentPathReservationResult
  acquireWorkspaceDocumentMutationLeases: (
    stamps: readonly WorkspaceDocumentTargetStamp[],
    ownerId: string,
  ) => WorkspaceDocumentMutationLeaseResult
  releaseWorkspaceDocumentMutationLeases: (leaseSet: WorkspaceDocumentMutationLeaseSet) => boolean
  retainWorkspaceDocumentMutationLeasesForPaths: (
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly string[],
  ) => WorkspaceDocumentMutationLeaseSet
  markWorkspaceDocumentRecoveryConflict: (
    affectedPaths: readonly string[],
    operationId: string,
  ) => WorkspaceDocumentRecoveryConflictResult
  clearWorkspaceDocumentRecoveryConflict: (operationId: string) => readonly string[]
  prepareWorkspaceDocumentRecoveryConflictTransfer: (
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly string[],
    operationId: string,
  ) => WorkspaceDocumentRecoveryLeaseTransferPreparationResult
  commitWorkspaceDocumentRecoveryConflictTransfer: (
    transfer: WorkspaceDocumentRecoveryLeaseTransfer,
  ) => readonly string[]
  commitWorkspaceDocumentProjection: (projection: WorkspaceDocumentProjection) => boolean
  rollbackWorkspaceDocumentProjection: (projection: WorkspaceDocumentProjection) => boolean
  removeEditorView: (tabId: string) => boolean
  renameLiveEditorDocumentPath: (from: string, to: string) => { wasDirty: boolean }
  runWorkspaceDocumentBatch: <T>(run: () => T) => T
  /** Replaces the scroll-restore seeds (e.g. after a workspace switch). Not reactive. */
  seedEditorScrollPositions: (byPath: Readonly<Record<string, EditorScrollPosition>>) => void
  /** The single eviction path: everything outside the keep sets is dropped. */
  retainEditorDocuments: (keep: DocumentRetention) => {
    evictedDocumentIds: string[]
    evictedTabIds: string[]
  }
  setEditorViewScrollPosition: (tabId: string, scrollPosition: EditorScrollPosition) => void
  setLiveEditorDocumentDirty: (documentId: string, dirty: boolean) => void
}

/**
 * The service owns every document fact; this store owns none. Its state type is
 * the service's state type — so a field can only ever be declared once — and
 * every action is "mutate the service, then publish its state". Reads go to the
 * service rather than to the published copy, which is the same object either
 * way: the service hands out the stored document, not a projection of it.
 */
export type EditorDocumentStore = WorkspaceDocumentServiceState & EditorDocumentStoreActions

export type EditorDocumentStoreApi = Mutate<
  StoreApi<EditorDocumentStore>,
  [['zustand/subscribeWithSelector', never]]
>

export const EditorDocumentStateContext = createContext<EditorDocumentStoreApi | null>(null)

export function useEditorDocumentStoreApi() {
  const store = use(EditorDocumentStateContext)
  if (!store) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useEditorDocumentStoreApi must be used within EditorStateProvider',
    })
  }

  return store
}

export function useEditorDocumentState<T>(selector: (state: EditorDocumentStore) => T): T {
  return useStore(useEditorDocumentStoreApi(), selector)
}

export function createEditorDocumentStore(options: CreateEditorDocumentStoreOptions = {}) {
  return createStore<EditorDocumentStore>()(
    subscribeWithSelector((set) => {
      let service: WorkspaceDocumentService
      const publication = new StorePublicationGate(() => set(service.state()))
      const publish = () => publication.request()
      service = new WorkspaceDocumentService(publish)
      if (options.scrollPositionSeeds) service.seedScrollPositions(options.scrollPositionSeeds)

      return {
        ...service.state(),
        deleteLiveEditorDocument: (documentId) => {
          const result = service.deleteLiveDocument(documentId)
          publish()
          return result
        },
        ensureEditorView: (tabId, file, claim) => {
          const viewDocument = service.ensureView(tabId, file, claim)
          publish()
          return viewDocument
        },
        ensureEditorViewForDocument: (tabId, documentId, claim) => {
          const viewDocument = service.ensureViewForDocument(tabId, documentId, claim)
          publish()
          return viewDocument
        },
        ensureLiveEditorDocument: (file, claim) => {
          const document = service.ensureLiveDocument(file, claim)
          publish()
          return document
        },
        ensureUnsyncedEditorDocument: (input) => {
          const document = service.ensureUnsyncedDocument(input)
          publish()
          return document
        },
        forceReplaceLiveEditorDocument: (file) => {
          const result = service.forceReplaceLiveDocument(file)
          if (result.changed) publish()
          return { wasDirty: result.wasDirty }
        },
        getEditorView: (tabId) => service.getView(tabId),
        editorDocumentSizes: () => service.documentSizes(),
        getLiveEditorDocument: (documentId) => service.getLiveDocument(documentId),
        hasLiveEditorDocument: (documentId) => service.hasLiveDocument(documentId),
        markLiveEditorDocumentSaved: (input) => {
          const marked = service.markSaved(input)
          publish()
          return marked
        },
        markSettingsDocumentSaved: (input) => {
          const marked = service.markSettingsSaved(input)
          publish()
          return marked
        },
        markSettingsDocumentConflict: (documentId, confirmedText, revision) => {
          const marked = service.markSettingsConflict(documentId, confirmedText, revision)
          if (marked) publish()
          return marked
        },
        reloadSettingsDocument: (documentId) => {
          const reloaded = service.reloadSettingsDocument(documentId)
          if (reloaded) publish()
          return reloaded
        },
        replaceUnsyncedEditorDocumentText: (documentId, text) => {
          const replaced = service.replaceUnsyncedDocumentText(documentId, text)
          if (replaced) publish()
          return replaced
        },
        reconcileSettingsDocument: (documentId, text, revision) => {
          const reconciled = service.reconcileSettingsDocument(documentId, text, revision)
          if (reconciled) publish()
          return reconciled
        },
        prepareWorkspaceDocumentTarget: (documentId) => service.prepareTargetStamp(documentId),
        isWorkspaceDocumentTargetCurrent: (stamp) => service.isTargetStampCurrent(stamp),
        prepareWorkspaceDocumentDelete: (path, reservation) =>
          service.prepareDeleteProjection(path, reservation),
        prepareWorkspaceDocumentRename: (from, to, reservation) =>
          service.prepareRenameProjection(from, to, reservation),
        prepareWorkspaceDocumentPathReservation: (path) => service.preparePathReservation(path),
        reserveWorkspaceDocumentPaths: (requests, ownerId) =>
          service.reservePaths(requests, ownerId),
        releaseWorkspaceDocumentPaths: (reservation) => service.releasePaths(reservation),
        acquireWorkspaceDocumentMutationLeases: (stamps, ownerId) =>
          service.acquireMutationLeases(stamps, ownerId),
        releaseWorkspaceDocumentMutationLeases: (leaseSet) =>
          service.releaseMutationLeases(leaseSet),
        retainWorkspaceDocumentMutationLeasesForPaths: (leaseSet, affectedPaths) =>
          service.retainMutationLeasesForPaths(leaseSet, affectedPaths),
        markWorkspaceDocumentRecoveryConflict: (affectedPaths, operationId) => {
          const result = service.markRecoveryConflict(affectedPaths, operationId)
          if (result.status === 'acquired') publish()
          return result
        },
        clearWorkspaceDocumentRecoveryConflict: (operationId) => {
          const cleared = service.clearRecoveryConflict(operationId)
          if (cleared.length > 0) publish()
          return cleared
        },
        prepareWorkspaceDocumentRecoveryConflictTransfer: (leaseSet, affectedPaths, operationId) =>
          service.prepareMutationLeaseRecoveryConflictTransfer(
            leaseSet,
            affectedPaths,
            operationId,
          ),
        commitWorkspaceDocumentRecoveryConflictTransfer: (transfer) => {
          const conflictedPaths = service.commitMutationLeaseRecoveryConflictTransfer(transfer)
          publish()
          return conflictedPaths
        },
        commitWorkspaceDocumentProjection: (projection) => {
          const committed = service.commitProjection(projection)
          if (committed) publish()
          return committed
        },
        rollbackWorkspaceDocumentProjection: (projection) => {
          const rolledBack = service.rollbackProjection(projection)
          if (rolledBack) publish()
          return rolledBack
        },
        removeEditorView: (tabId) => {
          const removed = service.removeView(tabId)
          if (removed) publish()
          return removed
        },
        renameLiveEditorDocumentPath: (from, to) => {
          const result = service.renameLiveDocument(from, to)
          publish()
          return result
        },
        runWorkspaceDocumentBatch: (run) => publication.run(run),
        retainEditorDocuments: (keep) => {
          const result = service.retain(keep)
          publish()
          return result
        },
        setEditorViewScrollPosition: (tabId, scrollPosition) => {
          const changed = service.setViewScrollPosition(tabId, scrollPosition)
          // Runs at scroll rate; service.state() keeps unchanged slices
          // referentially stable, so this notify only re-renders subscribers of
          // the scroll position itself.
          if (changed) publish()
        },
        seedEditorScrollPositions: (byPath) => service.seedScrollPositions(byPath),
        setLiveEditorDocumentDirty: (documentId, dirty) => {
          service.setDirty(documentId, dirty)
          publish()
        },
      }
    }),
  )
}

class StorePublicationGate {
  private depth = 0
  private pending = false

  constructor(private readonly emit: () => void) {}

  request(): void {
    if (this.depth === 0) {
      this.emit()
      return
    }
    this.pending = true
  }

  run<T>(run: () => T): T {
    this.depth += 1
    try {
      return run()
    } finally {
      this.finish()
    }
  }

  private finish(): void {
    this.depth -= 1
    if (this.depth > 0 || !this.pending) return

    this.pending = false
    this.emit()
  }
}
