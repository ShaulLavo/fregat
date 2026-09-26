import { useForesight } from '@/hooks/use-foresight'

import {
  editorTabPrefetchRegistrationKey,
  editorTabFileOpenIntent,
  editorTabPrefetchTarget,
  type EditorTabPrefetchCandidate,
} from '@/features/workspace/utils/tab-prefetch'
import { FILE_SNAPSHOT_STALE_MS } from '@/lib/file-snapshot-query-cache'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'

export function useEditorTabIntentPrefetch(tab: EditorTabPrefetchCandidate) {
  const { service: fileOpenIntent } = useFileOpenIntent()
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const target = editorTabPrefetchTarget(tab)
  const registrationKey = target ? editorTabPrefetchRegistrationKey(target) : null

  function prefetchTab() {
    if (!target || !rootPath) return

    fileOpenIntent.prepare(editorTabFileOpenIntent(rootPath, target))
  }

  const { elementRef } = useForesight<HTMLButtonElement>({
    callback: prefetchTab,
    enabled: target !== null && rootPath !== null,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: target ? { path: target.path, rootPath, tabId: target.id } : { tabId: tab.id },
    name: registrationKey ? `editor-tab:${registrationKey}` : `editor-tab:${tab.id}:disabled`,
    reactivateAfter: FILE_SNAPSHOT_STALE_MS,
  })

  return elementRef
}
