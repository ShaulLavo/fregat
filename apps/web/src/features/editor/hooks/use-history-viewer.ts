import {
  compareHistoryStates,
  historyComparisonInput,
  type HistoryComparisonResult,
} from '@/features/editor/utils/history-compare'
import type { SnapshotComparisonScope } from '@/lib/documents/utils/snapshot-comparison'
import type { HistoryComparisonInput, SnapshotComparisonLease } from '@/lib/snapshot-comparison'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import type { HistoryPresentation } from '@/features/editor/state/tab-presentation'
import {
  createHistoryViewer,
  type EditorTextBuffer,
  type HistoryViewer,
  type HistoryViewerState,
} from '@singapore-editor/core/document'
import { useMemo, useSyncExternalStore } from 'react'

type Viewer = HistoryViewer<HistoryComparisonResult>

export type HistoryViewerSnapshot = {
  readonly viewer: Viewer
  readonly state: HistoryViewerState<HistoryComparisonResult>
  readonly focusedComparison: HistoryComparisonResult | null
}

type ViewerSource = {
  subscribe(listener: () => void): () => void
  getSnapshot(): HistoryViewerSnapshot | null
}

const EMPTY_SOURCE: ViewerSource = {
  subscribe: () => () => undefined,
  getSnapshot: () => null,
}

export function useHistoryViewer(
  buffer: EditorTextBuffer | null,
  path: FilesystemPath,
  rootPath: FilesystemPath,
  tabId?: TabId,
): HistoryViewerSnapshot | null {
  const { history } = useTabPresentation(tabId)
  const documents = useEditorDocumentStoreApi()
  const environmentId = useEnvironmentId()
  // Stable identity: the source owns the viewer and its buffer subscription.
  // Manual memo: useSyncExternalStore resubscribes when `source.subscribe` changes, and the
  // compiler's cache is a cache, not an identity guarantee — a recompute drops the viewer.
  const source = useMemo(
    () =>
      buffer
        ? createHistoryViewerSource({
            buffer,
            path,
            presentation: history,
            documents,
            scope: { environmentId, rootPath },
            tabId,
          })
        : EMPTY_SOURCE,
    [buffer, documents, environmentId, history, path, rootPath, tabId],
  )
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

// The viewer lives exactly as long as someone is subscribed, so StrictMode's
// mount-unmount-mount rehearsal cannot dispose the one the component keeps. The
// snapshot carries the viewer too: a method read the compiler could cache would
// otherwise hand back the pre-subscription null for good.
export function createHistoryViewerSource({
  buffer,
  path,
  presentation,
  documents,
  scope,
  tabId,
  compare = compareHistoryStates,
}: {
  buffer: EditorTextBuffer
  path: FilesystemPath
  presentation: HistoryPresentation
  documents: EditorDocumentStoreApi
  scope: SnapshotComparisonScope
  tabId?: TabId
  compare?: (
    old: HistoryComparisonInput['old'],
    next: HistoryComparisonInput['new'],
    path: FilesystemPath,
  ) => HistoryComparisonResult | Promise<HistoryComparisonResult>
}): ViewerSource {
  let viewer: Viewer | null = null
  let snapshot: HistoryViewerSnapshot | null = null
  let subscribers = 0
  let displayed: SnapshotComparisonLease | null = null
  let logical: SnapshotComparisonLease | null = null
  let requested: SnapshotComparisonLease | null = null
  let focusedComparison: HistoryComparisonResult | null = null
  const acquire = (input: HistoryComparisonInput, signal: AbortSignal) =>
    documents.getState().acquireSnapshotComparison({ input, signal })
  const display = (input: HistoryComparisonInput | null) => {
    const read = displayed?.read()
    if (input && read?.kind === 'ready' && read.input === input) return
    const previous = displayed
    displayed = input ? acquire(input, new AbortController().signal) : null
    if (!input) logical?.release()
    if (input && tabId)
      logical = documents.getState().prepareSnapshotComparisonTab(tabId, {
        input,
        signal: new AbortController().signal,
      })
    previous?.release()
  }
  const refresh = () => {
    if (!viewer) {
      snapshot = null
      return
    }
    const state = viewer.getState()
    presentation.focusedId = state.focusedId
    presentation.selectedIds = state.selectedIds
    if (state.selectedIds.length === 2) {
      settleSelected(state)
    } else {
      refreshFocused(state)
    }
    snapshot = { viewer, state, focusedComparison }
  }
  const settleSelected = (state: HistoryViewerState<HistoryComparisonResult>) => {
    const comparison = state.comparison
    if (
      !comparison ||
      comparison.left.id !== state.selectedIds[0] ||
      comparison.right.id !== state.selectedIds[1] ||
      comparison.status === 'pending'
    )
      return
    if (!requested) return
    const read = requested.read()
    display(
      state.comparison?.status === 'ready' &&
        read?.kind === 'ready' &&
        read.input.kind === 'history'
        ? read.input
        : null,
    )
    requested?.release()
    requested = null
  }
  const refreshFocused = (state: HistoryViewerState<HistoryComparisonResult>) => {
    const current = viewer?.node(state.graph.currentId)
    const focused = state.focusedId === null ? null : viewer?.node(state.focusedId)
    requested?.release()
    requested = null
    if (!current || !focused || focused.isCurrent || state.lostIds.length > 0) {
      focusedComparison = null
      display(null)
      return
    }
    const input = historyComparisonInput(buffer, path, scope, current, focused)
    const previous = displayed?.read()
    if (
      previous?.kind === 'ready' &&
      previous.input.kind === 'history' &&
      previous.input.old.id === current.id &&
      previous.input.new.id === focused.id &&
      previous.input.old.snapshot === current.snapshot &&
      previous.input.new.snapshot === focused.snapshot &&
      previous.input.old.revision === current.revision &&
      previous.input.new.revision === focused.revision
    )
      return
    focusedComparison = compareHistoryStates(input.old, input.new, input.path)
    display(input)
  }
  return {
    subscribe(listener) {
      subscribers += 1
      if (!viewer) {
        viewer = createHistoryViewer<HistoryComparisonResult>(buffer, {
          compare: async (left, right, signal) => {
            const input = historyComparisonInput(buffer, path, scope, left, right)
            requested = acquire(input, signal)
            return compare(input.old, input.new, input.path)
          },
        })
        if (presentation.focusedId !== null) viewer.focus(presentation.focusedId)
        for (const id of presentation.selectedIds) viewer.toggleSelection(id)
        refresh()
      }
      const unsubscribe = viewer.subscribe(() => {
        refresh()
        listener()
      })
      return () => {
        unsubscribe()
        subscribers -= 1
        if (subscribers > 0) return
        viewer?.dispose()
        requested?.release()
        requested = null
        displayed?.release()
        displayed = null
        focusedComparison = null
        viewer = null
        refresh()
      }
    },
    getSnapshot: () => snapshot,
  }
}
