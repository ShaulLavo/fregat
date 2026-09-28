import { activeEditorGroup } from '@/lib/documents/utils/groups'
import type { FileOpenIntentService } from '@/lib/file-open-intent/state/service'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { adjacentTabIntents } from '@/features/editor/utils/adjacent-tab-intents'

// Long enough for the new tab to mount and post its own parse, which the idle fence then awaits.
const ADJACENT_TAB_SETTLE_MS = 250

/**
 * Keyboard tab commands press without a pointer, so each tab switch prepares their next targets.
 * They wait for the new tab to paint: their stages share its syntax workers.
 */
export function watchAdjacentTabIntents(
  workspaceStore: EditorWorkspaceStoreApi,
  service: FileOpenIntentService,
): () => void {
  let cancel = () => {}
  const unsubscribe = workspaceStore.subscribe(
    (state) => activeEditorGroup(state.workbenchPanels.editorGroups).selectedTabId,
    () => {
      cancel()
      let current = true
      const timer = setTimeout(() => {
        // A worker that failed its fence has nothing to prepare into.
        void awaitEditorSyntaxWorkerIdleFences().then(
          () => {
            if (!current) return
            for (const intent of adjacentTabIntents(workspaceStore.getState())) {
              service.prepare(intent)
            }
          },
          () => undefined,
        )
      }, ADJACENT_TAB_SETTLE_MS)
      cancel = () => {
        current = false
        clearTimeout(timer)
      }
    },
  )
  return () => {
    cancel()
    unsubscribe()
  }
}
