import { clientErrors } from '@/lib/structured-errors'
import type { FileResult } from '@/lib/file-system-types'
import { type EditorScrollPosition } from '@singapore-editor/core/editor'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla'
import type { DocumentRetention } from '@/features/editor/utils/document-retention'
import type { PreparedFileOpenClaim } from '@/lib/file-open-intent/types'
import type {
  DocumentKey,
  FilesystemPath,
  ReopenScrollPosition,
  EditorViewScrollPosition,
  SettingsDocumentRef,
  TabId,
} from '@/lib/documents/utils/types'
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
  scrollPositionSeeds?: readonly ReopenScrollPosition[]
  viewScrollPositionSeeds?: readonly EditorViewScrollPosition[]
}

type EditorDocumentStoreActions = {
  deleteLiveEditorDocument: (documentKey: DocumentKey) => DeleteLiveEditorDocumentResult
  ensureEditorView: (
    tabId: TabId,
    file: FileResult,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorViewDocument
  ensureEditorViewForDocument: (
    tabId: TabId,
    documentKey: DocumentKey,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorViewDocument
  ensureLiveEditorDocument: (
    file: FileResult,
    claim?: PreparedFileOpenClaim | null,
  ) => LiveEditorDocument
  ensureUnsyncedEditorDocument: (input: UnsyncedLiveEditorDocumentInput) => LiveEditorDocument
  ensureSettingsDocument: (
    target: SettingsDocumentRef,
    snapshot: { readonly content: string; readonly revision: string },
  ) => LiveEditorDocument
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  /** Retained text size per live document; the only input to the retention budget. */
  editorDocumentSizes: () => ReadonlyMap<DocumentKey, number>
  /** Documents `retain` keeps whatever the keep set says; their text is unavoidable. */
  unevictableEditorDocumentKeys: () => ReadonlySet<DocumentKey>
  getEditorView: (tabId: TabId) => EditorDocumentView | null
  getLiveEditorDocument: (documentKey: DocumentKey) => LiveEditorDocument | null
  hasLiveEditorDocument: (documentKey: DocumentKey) => boolean
  setFileOrphaned: (documentKey: DocumentKey, orphaned: boolean) => boolean
  markLiveEditorDocumentSaved: (input: {
    documentKey: DocumentKey
    fileVersion: string
    mtimeMs: number
    savedContentRevision: string
    savedText: string
  }) => boolean
  markSettingsDocumentSaved: (input: {
    documentKey: DocumentKey
    revision: string
    savedContentRevision: string
    savedText: string
  }) => boolean
  markSettingsDocumentConflict: (
    documentKey: DocumentKey,
    confirmedText: string | null,
    revision: string | null,
  ) => boolean
  reloadSettingsDocument: (documentKey: DocumentKey) => boolean
  /** Re-seeds a synthetic buffer from text the server rewrote; see the service. */
  replaceUnsyncedEditorDocumentText: (documentKey: DocumentKey, text: string) => boolean
  /** Brings a clean settings buffer back in step with the file; see the service. */
  reconcileSettingsDocument: (documentKey: DocumentKey, text: string, revision: string) => boolean
  prepareWorkspaceDocumentTarget: (documentKey: DocumentKey) => WorkspaceDocumentTargetStamp | null
  isWorkspaceDocumentTargetCurrent: (stamp: WorkspaceDocumentTargetStamp) => boolean
  prepareWorkspaceDocumentDelete: (
    path: FilesystemPath,
    reservation?: WorkspaceDocumentPathReservation | null,
  ) => WorkspaceDocumentDeleteProjection | null
  prepareWorkspaceDocumentRename: (
    from: FilesystemPath,
    to: FilesystemPath,
    reservation?: WorkspaceDocumentPathReservation | null,
  ) => WorkspaceDocumentRenameProjection | null
  prepareWorkspaceDocumentPathReservation: (
    path: FilesystemPath,
  ) => WorkspaceDocumentPathReservationRequest
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
    affectedPaths: readonly FilesystemPath[],
  ) => WorkspaceDocumentMutationLeaseSet
  markWorkspaceDocumentRecoveryConflict: (
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ) => WorkspaceDocumentRecoveryConflictResult
  clearWorkspaceDocumentRecoveryConflict: (operationId: string) => readonly FilesystemPath[]
  prepareWorkspaceDocumentRecoveryConflictTransfer: (
    leaseSet: WorkspaceDocumentMutationLeaseSet,
    affectedPaths: readonly FilesystemPath[],
    operationId: string,
  ) => WorkspaceDocumentRecoveryLeaseTransferPreparationResult
  commitWorkspaceDocumentRecoveryConflictTransfer: (
    transfer: WorkspaceDocumentRecoveryLeaseTransfer,
  ) => readonly FilesystemPath[]
  commitWorkspaceDocumentProjection: (projection: WorkspaceDocumentProjection) => boolean
  rollbackWorkspaceDocumentProjection: (projection: WorkspaceDocumentProjection) => boolean
  removeEditorView: (tabId: TabId) => boolean
  renameLiveEditorDocumentPath: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
  runWorkspaceDocumentBatch: <T>(run: () => T) => T
  /** Replaces the scroll-restore seeds (e.g. after a workspace switch). Not reactive. */
  seedEditorScrollPositions: (entries: readonly ReopenScrollPosition[]) => void
  seedEditorViewScrollPositions: (entries: readonly EditorViewScrollPosition[]) => void
  copyEditorView: (from: TabId, to: TabId) => void
  /** The single eviction path: everything outside the keep sets is dropped. */
  retainEditorDocuments: (keep: DocumentRetention) => {
    evictedDocumentKeys: DocumentKey[]
    evictedTabIds: TabId[]
  }
  setEditorViewScrollPosition: (
    tabId: TabId,
    scrollPosition: EditorScrollPosition,
    reopenScrollPosition?: EditorScrollPosition,
  ) => void
  setLiveEditorDocumentDirty: (documentKey: DocumentKey, dirty: boolean) => void
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
      if (options.viewScrollPositionSeeds)
        service.seedViewScrollPositions(options.viewScrollPositionSeeds)

      return {
        ...service.state(),
        deleteLiveEditorDocument: (documentKey) => {
          const result = service.deleteLiveDocument(documentKey)
          publish()
          return result
        },
        ensureEditorView: (tabId, file, claim) => {
          const viewDocument = service.ensureView(tabId, file, claim)
          publish()
          return viewDocument
        },
        ensureEditorViewForDocument: (tabId, documentKey, claim) => {
          const viewDocument = service.ensureViewForDocument(tabId, documentKey, claim)
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
        ensureSettingsDocument: (target, snapshot) => {
          const document = service.ensureSettingsDocument(target, snapshot)
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
        unevictableEditorDocumentKeys: () => service.unevictableDocumentKeys(),
        getLiveEditorDocument: (documentKey) => service.getLiveDocument(documentKey),
        hasLiveEditorDocument: (documentKey) => service.hasLiveDocument(documentKey),
        setFileOrphaned: (documentKey, orphaned) => {
          const changed = service.setFileOrphaned(documentKey, orphaned)
          if (changed) publish()
          return changed
        },
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
        markSettingsDocumentConflict: (documentKey, confirmedText, revision) => {
          const marked = service.markSettingsConflict(documentKey, confirmedText, revision)
          if (marked) publish()
          return marked
        },
        reloadSettingsDocument: (documentKey) => {
          const reloaded = service.reloadSettingsDocument(documentKey)
          if (reloaded) publish()
          return reloaded
        },
        replaceUnsyncedEditorDocumentText: (documentKey, text) => {
          const replaced = service.replaceUnsyncedDocumentText(documentKey, text)
          if (replaced) publish()
          return replaced
        },
        reconcileSettingsDocument: (documentKey, text, revision) => {
          const reconciled = service.reconcileSettingsDocument(documentKey, text, revision)
          if (reconciled) publish()
          return reconciled
        },
        prepareWorkspaceDocumentTarget: (documentKey) => service.prepareTargetStamp(documentKey),
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
        setEditorViewScrollPosition: (tabId, scrollPosition, reopenScrollPosition) => {
          const changed = service.setViewScrollPosition(tabId, scrollPosition, reopenScrollPosition)
          // Runs at scroll rate; service.state() keeps unchanged slices
          // referentially stable, so this notify only re-renders subscribers of
          // the scroll position itself.
          if (changed) publish()
        },
        seedEditorScrollPositions: (byPath) => service.seedScrollPositions(byPath),
        seedEditorViewScrollPositions: (entries) => service.seedViewScrollPositions(entries),
        copyEditorView: (from, to) => {
          service.copyView(from, to)
          publish()
        },
        setLiveEditorDocumentDirty: (documentKey, dirty) => {
          service.setDirty(documentKey, dirty)
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
