import {
  compareHistoryStates,
  type HistoryComparisonResult,
} from '@/features/editor/utils/history-compare'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import type { HistoryPresentation } from '@/features/editor/state/tab-presentation'
import {
  createHistoryViewer,
  type EditorTextBuffer,
  type HistoryViewer,
  type HistoryViewerState,
} from '@singapore-editor/core'
import { useMemo, useSyncExternalStore } from 'react'

type Viewer = HistoryViewer<HistoryComparisonResult>

export type HistoryViewerSnapshot = {
  readonly viewer: Viewer
  readonly state: HistoryViewerState<HistoryComparisonResult>
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
  tabId?: TabId,
): HistoryViewerSnapshot | null {
  const { history } = useTabPresentation(tabId)
  // Stable identity: the source owns the viewer and its buffer subscription.
  const source = useMemo(
    () => (buffer ? viewerSource(buffer, path, history) : EMPTY_SOURCE),
    [buffer, history, path],
  )
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

// The viewer lives exactly as long as someone is subscribed, so StrictMode's
// mount-unmount-mount rehearsal cannot dispose the one the component keeps. The
// snapshot carries the viewer too: a method read the compiler could cache would
// otherwise hand back the pre-subscription null for good.
function viewerSource(
  buffer: EditorTextBuffer,
  path: FilesystemPath,
  presentation: HistoryPresentation,
): ViewerSource {
  let viewer: Viewer | null = null
  let snapshot: HistoryViewerSnapshot | null = null
  let subscribers = 0
  const refresh = () => {
    snapshot = viewer ? { viewer, state: viewer.getState() } : null
    if (!snapshot) return
    presentation.focusedId = snapshot.state.focusedId
    presentation.selectedIds = snapshot.state.selectedIds
  }
  return {
    subscribe(listener) {
      subscribers += 1
      if (!viewer) {
        viewer = createHistoryViewer<HistoryComparisonResult>(buffer, {
          compare: async (left, right) => compareHistoryStates(left, right, path),
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
        viewer = null
        refresh()
      }
    },
    getSnapshot: () => snapshot,
  }
}
