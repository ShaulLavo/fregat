import {
  compareHistoryStates,
  type HistoryComparisonResult,
} from '@/features/editor/utils/history-compare'
import type { FilesystemPath } from '@/lib/documents/utils/types'
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
): HistoryViewerSnapshot | null {
  // Stable identity: the source owns the viewer and its buffer subscription.
  const source = useMemo(() => (buffer ? viewerSource(buffer, path) : EMPTY_SOURCE), [buffer, path])
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

// The viewer lives exactly as long as someone is subscribed, so StrictMode's
// mount-unmount-mount rehearsal cannot dispose the one the component keeps. The
// snapshot carries the viewer too: a method read the compiler could cache would
// otherwise hand back the pre-subscription null for good.
function viewerSource(buffer: EditorTextBuffer, path: FilesystemPath): ViewerSource {
  let viewer: Viewer | null = null
  let snapshot: HistoryViewerSnapshot | null = null
  let subscribers = 0
  const refresh = () => {
    snapshot = viewer ? { viewer, state: viewer.getState() } : null
  }
  return {
    subscribe(listener) {
      subscribers += 1
      if (!viewer) {
        viewer = createHistoryViewer<HistoryComparisonResult>(buffer, {
          compare: async (left, right) => compareHistoryStates(left, right, path),
        })
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
