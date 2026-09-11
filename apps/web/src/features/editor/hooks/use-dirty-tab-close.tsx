import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import type { EditorSaveService } from '@/features/editor/state/save-service'

import { UnsavedChangesDialog } from '@/features/editor/components/unsaved-changes-dialog'
import { useWorkspaceMutationAllowed } from '@/features/editor/hooks/use-workspace-mutation-allowed'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import type {
  WorkspaceEditService,
  WorkspaceMutationReporter,
} from '@/features/editor/state/workspace-edit-service'
import { editorTabDocumentIds } from '@/features/workspace/utils/tab-dirty'
import { isDirtyLiveEditorDocument, isSavableEditorDocument } from '@/features/editor/utils/save'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  activeEditorTabForWorkbenchPanels,
  editorPathCountsForWorkbenchPanels,
  editorTabRecordsForWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { parseCompareSavedDocumentId } from '@/features/editor/utils/compare-saved-document'
import { parseDiffDocumentId } from '@/features/git/utils/diff-document'
import { parseSearchBufferDocumentId } from '@/features/search/utils/buffer-document'
import { errorMessage } from '@/lib/file-server'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import {
  focusTargetById,
  registeredFocusTarget,
  type FocusDestination,
  type FocusService,
  type FocusTargetToken,
} from '@/lib/focus/state/service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'
import type { NavigationResult } from '@/state/navigation-coordinator'

declare const unsavedDialogTargetBrand: unique symbol

export type UnsavedDialogTarget = {
  readonly [unsavedDialogTargetBrand]: true
}

export type CloseRequestResult =
  | {
      readonly status: 'closed'
      readonly tabIds: readonly string[]
      readonly completion: Promise<NavigationResult>
    }
  | {
      readonly status: 'deferred'
      readonly dialogTarget: UnsavedDialogTarget
      readonly tabIds: readonly string[]
    }
  | { readonly status: 'rejected'; readonly reason: 'busy' | 'not-found' }

export type RequestCloseTab = (tabId: string) => CloseRequestResult
export type RequestCloseTabs = (tabIds: readonly string[]) => CloseRequestResult

type PendingClose = {
  dialogTarget: UnsavedDialogTarget
  path: string
  tabIds: readonly string[]
}

type PendingCloseFocus =
  | { readonly cancelled: boolean; readonly kind: 'finish' }
  | { readonly dialogTarget: UnsavedDialogTarget; readonly kind: 'dialog' }

const EMPTY_PENDING_CLOSES: readonly PendingClose[] = []

export function useDirtyTabCloseRequest() {
  const focus = useFocusService()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const workspaceEdits = useOptionalWorkspaceEditService()
  const mutationsEnabled = useWorkspaceMutationAllowed()
  const { saveService } = useEditorRuntime()
  const { closeTabs, discardAndCloseTabs } = useEditorCommands()
  const closeOriginRef = useRef<FocusTargetToken | null>(null)
  const pendingFocusRef = useRef<PendingCloseFocus | null>(null)
  const pendingClosesRef = useRef<readonly PendingClose[]>(EMPTY_PENDING_CLOSES)
  const [pendingCloses, setPendingCloses] = useState(EMPTY_PENDING_CLOSES)
  const pendingClose = pendingCloses[0] ?? null
  const pendingPath = pendingClose?.path ?? null
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Savable, not file-backed: closing a dirty settings.json tab has to offer
  // Save, and that save goes to the settings route rather than the fs one.
  const pendingDocumentState = documentStore.getState()
  const pendingDocumentIds = pendingPath ? editorTabDocumentIds(pendingPath) : []
  const dirtyPendingDocumentIds = pendingDocumentIds.filter((id) =>
    isDirtyLiveEditorDocument(pendingDocumentState, id),
  )
  const canSavePendingPath =
    mutationsEnabled &&
    dirtyPendingDocumentIds.length > 0 &&
    dirtyPendingDocumentIds.every((id) => {
      const document = pendingDocumentState.getLiveEditorDocument(id)
      return document ? isSavableEditorDocument(document) : false
    })
  const publishPendingCloses = useCallback((next: readonly PendingClose[]) => {
    pendingClosesRef.current = next
    setPendingCloses(next)
  }, [])

  const finishPendingFocus = useCallback(
    (cancelled: boolean) => {
      const origin = closeOriginRef.current
      closeOriginRef.current = null
      if (cancelled && restoreRegisteredOrigin(focus, origin)) return

      const destination = activeCloseSuccessorDestination(workspaceStore)
      if (destination) {
        focus.request(destination)
        return
      }

      focus.request(focusTargetById({ kind: 'app-shell' }))
    },
    [focus, workspaceStore],
  )

  const clearPendingClose = useCallback(() => {
    pendingFocusRef.current = { cancelled: true, kind: 'finish' }
    publishPendingCloses(EMPTY_PENDING_CLOSES)
    setSaveError(null)
  }, [publishPendingCloses])

  const advancePendingClose = useCallback(() => {
    const current = pendingClosesRef.current
    const remaining = current.length <= 1 ? EMPTY_PENDING_CLOSES : current.slice(1)
    const next = remaining[0]
    pendingFocusRef.current = next
      ? { dialogTarget: next.dialogTarget, kind: 'dialog' }
      : { cancelled: false, kind: 'finish' }
    publishPendingCloses(remaining)
    setSaveError(null)
  }, [publishPendingCloses])

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current
    if (!pendingFocus) return
    if (pendingFocus.kind === 'dialog') {
      if (pendingClose?.dialogTarget !== pendingFocus.dialogTarget) return

      pendingFocusRef.current = null
      focus.request(
        focusTargetById({
          dialogTarget: pendingFocus.dialogTarget,
          kind: 'unsaved-dialog',
        }),
      )
      return
    }
    if (pendingClose) return

    pendingFocusRef.current = null
    finishPendingFocus(pendingFocus.cancelled)
  }, [finishPendingFocus, focus, pendingClose])

  const requestCloseTabs = useCallback<RequestCloseTabs>(
    (tabIds) => {
      if (pendingClosesRef.current.length > 0) {
        return { status: 'rejected', reason: 'busy' }
      }

      const origin = captureDirtyCloseOrigin(focus)

      const workspace = workspaceStore.getState()
      const openTabs = openTabCloseTargets(tabIds, workspace.workbenchPanels)
      if (openTabs.length === 0) return { status: 'rejected', reason: 'not-found' }
      const state = documentStore.getState()
      const pending: PendingClose[] = []
      const cleanTabIds: string[] = []
      const closingPathCounts = tabClosePathCounts(openTabs)
      const openPathCounts = editorPathCountsForWorkbenchPanels(workspace.workbenchPanels)

      for (const tab of openTabs) {
        // Of the documents behind the tab: the settings tab's text lives in
        // per-scope buffers, so asking its own path is always false and it
        // closed without a prompt.
        const dirty = editorTabDocumentIds(tab.path).some((id) =>
          isDirtyLiveEditorDocument(state, id),
        )
        const closingLastPathTab = closingPathCounts.get(tab.path) === openPathCounts.get(tab.path)
        if (dirty && closingLastPathTab) {
          appendPendingClose(pending, tab.path, tab.id)
          continue
        }

        cleanTabIds.push(tab.id)
      }

      const completion = closeTabs(cleanTabIds)
      publishPendingCloses(pendingClosesForRequest(pendingClosesRef.current, pending))
      setSaveError(null)

      const requestedTabIds = openTabs.map((tab) => tab.id)
      const firstPending = pending[0]
      if (!firstPending) {
        closeOriginRef.current = null
        return { status: 'closed', tabIds: requestedTabIds, completion }
      }

      closeOriginRef.current = origin

      return {
        status: 'deferred',
        dialogTarget: firstPending.dialogTarget,
        tabIds: requestedTabIds,
      }
    },
    [closeTabs, documentStore, focus, publishPendingCloses, workspaceStore],
  )

  const requestCloseTab = useCallback<RequestCloseTab>(
    (tabId) => requestCloseTabs([tabId]),
    [requestCloseTabs],
  )

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return
      if (saving) return

      clearPendingClose()
    },
    [clearPendingClose, saving],
  )

  const handleCancel = useCallback(() => {
    if (saving) return

    clearPendingClose()
  }, [clearPendingClose, saving])

  const handleDiscard = useCallback(async () => {
    if (!pendingClose) return
    if (saving) return
    if (!pendingCloseIsOpen(pendingClose, workspaceStore.getState())) {
      advancePendingClose()
      return
    }

    await discardAndCloseTabs(pendingClose.tabIds)
    advancePendingClose()
  }, [advancePendingClose, discardAndCloseTabs, pendingClose, saving, workspaceStore])

  const handleSave = useCallback(() => {
    if (!pendingClose) return
    if (saving) return
    if (!mutationsEnabled) return

    void saveAndClosePendingTab(pendingClose, {
      advancePendingClose,
      closeTabs,
      documentStore,
      saveService,
      setSaveError,
      setSaving,
      workspaceEdits,
      workspaceStore,
    })
  }, [
    advancePendingClose,
    closeTabs,
    documentStore,
    pendingClose,
    saveService,
    saving,
    mutationsEnabled,
    workspaceEdits,
    workspaceStore,
  ])

  return {
    dirtyTabCloseDialog: (
      <UnsavedChangesDialog
        canSave={canSavePendingPath}
        error={saveError}
        open={pendingPath !== null}
        path={pendingPath}
        saving={saving}
        target={pendingClose?.dialogTarget ?? null}
        onCancel={handleCancel}
        onDiscard={handleDiscard}
        onOpenChange={handleOpenChange}
        onSave={handleSave}
      />
    ),
    requestCloseTab,
    requestCloseTabs,
  }
}

function captureDirtyCloseOrigin(focus: FocusService) {
  const current = focus.getSnapshot().currentOwner
  if (current && !current.capabilities.overlay && focus.isRegistered(current.token)) {
    return current.token
  }

  const last = focus.getSnapshot().lastCommandTarget
  return last && focus.isRegistered(last.token) ? last.token : null
}

function restoreRegisteredOrigin(focus: FocusService, origin: FocusTargetToken | null) {
  if (!origin || !focus.isRegistered(origin)) return false

  focus.request(registeredFocusTarget(origin))
  return true
}

function activeCloseSuccessorDestination(
  workspaceStore: ReturnType<typeof useEditorWorkspaceStoreApi>,
): FocusDestination | null {
  const workspace = workspaceStore.getState()

  const activeTab = activeEditorTabForWorkbenchPanels(workspace.workbenchPanels)
  if (!activeTab) return null

  const layout = workspace.uiMode
  const diffPath =
    parseCompareSavedDocumentId(activeTab.path) ?? parseDiffDocumentId(activeTab.path)?.path ?? null
  const searchRoot = parseSearchBufferDocumentId(activeTab.path)?.rootPath ?? null
  const identity = { diffPath, layout, searchRoot, tabId: activeTab.id } as const
  return {
    isValid: () => {
      const current = workspaceStore.getState()
      const currentTab = activeEditorTabForWorkbenchPanels(current.workbenchPanels)
      return (
        current.uiMode === layout &&
        currentTab?.id === activeTab.id &&
        currentTab.path === activeTab.path
      )
    },
    kind: 'match',
    matches: (target) => matchesActiveSurface(target, identity),
  }
}

function emptyPendingCloses(current: readonly PendingClose[]) {
  if (current.length === 0) return current

  return EMPTY_PENDING_CLOSES
}

function pendingClosesForRequest(
  current: readonly PendingClose[],
  pending: readonly PendingClose[],
) {
  if (pending.length > 0) return pending

  return emptyPendingCloses(current)
}

async function saveAndClosePendingTab(pendingClose: PendingClose, context: SaveAndCloseContext) {
  context.setSaving(true)
  context.setSaveError(null)

  try {
    if (!pendingCloseIsOpen(pendingClose, context.workspaceStore.getState())) {
      context.advancePendingClose()
      return
    }

    // Every document behind the tab, for the same reason the dirty check above
    // covers them: saving `settings:` finds no live document and reports a
    // failure the user cannot act on.
    const state = context.documentStore.getState()
    const documentIds = editorTabDocumentIds(pendingClose.path).filter((id) =>
      isDirtyLiveEditorDocument(state, id),
    )
    const saveDocuments = (reportAffectedPaths?: WorkspaceMutationReporter) =>
      context.saveService.saveMany(documentIds, (path) => reportAffectedPaths?.([path]))
    const results = context.workspaceEdits
      ? await context.workspaceEdits.runWorkspaceMutation(documentIds, saveDocuments)
      : await saveDocuments()
    if (results.some((saved) => !saved)) {
      context.setSaveError('This tab could not be saved.')
      return
    }

    await context.closeTabs(pendingClose.tabIds)
    context.advancePendingClose()
  } catch (error: unknown) {
    context.setSaveError(errorMessage(error))
  } finally {
    context.setSaving(false)
  }
}

type SaveAndCloseContext = {
  advancePendingClose: () => void
  closeTabs: (
    tabIds: readonly string[],
  ) => Promise<import('@/state/navigation-coordinator').NavigationResult>
  documentStore: ReturnType<typeof useEditorDocumentStoreApi>
  saveService: EditorSaveService
  setSaveError: (error: string | null) => void
  setSaving: (saving: boolean) => void
  workspaceEdits: WorkspaceEditService | null
  workspaceStore: ReturnType<typeof useEditorWorkspaceStoreApi>
}

function openTabCloseTargets(tabIds: readonly string[], workbenchPanels: WorkbenchPanels) {
  const seen = new Set<string>()
  const tabs: Array<{ id: string; path: string }> = []
  const tabsById = new Map(
    editorTabRecordsForWorkbenchPanels(workbenchPanels).map((tab) => [tab.id, tab]),
  )

  for (const tabId of tabIds) {
    if (seen.has(tabId)) continue
    seen.add(tabId)
    const tab = tabsById.get(tabId)
    if (!tab) continue
    tabs.push(tab)
  }

  return tabs
}

function tabClosePathCounts(tabs: readonly { path: string }[]) {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    counts.set(tab.path, (counts.get(tab.path) ?? 0) + 1)
  }

  return counts
}

function appendPendingClose(pending: PendingClose[], path: string, tabId: string) {
  const current = pending.find((close) => close.path === path)
  if (!current) {
    pending.push({ dialogTarget: createUnsavedDialogTarget(), path, tabIds: [tabId] })
    return
  }

  pending.splice(pending.indexOf(current), 1, {
    dialogTarget: current.dialogTarget,
    path,
    tabIds: current.tabIds.concat(tabId),
  })
}

function createUnsavedDialogTarget(): UnsavedDialogTarget {
  return {} as UnsavedDialogTarget
}

function pendingCloseIsOpen(
  pendingClose: PendingClose,
  workspace: { workbenchPanels: WorkbenchPanels },
) {
  const openTabIds = new Set(
    editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels).map((tab) => tab.id),
  )
  return pendingClose.tabIds.some((tabId) => openTabIds.has(tabId))
}
