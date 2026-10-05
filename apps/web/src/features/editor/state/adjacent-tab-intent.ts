import { activeEditorGroup } from '@/lib/documents/utils/groups'
import type {
  FileOpenIntent,
  FileOpenIntentInterest,
  FileOpenIntentService,
} from '@/lib/file-open-intent/state/service'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { adjacentTabIntents } from '@/features/editor/utils/adjacent-tab-intents'

// Lets the selected tab mount and post the parse that its shared worker fence awaits.
const ADJACENT_TAB_SETTLE_MS = 250

export function watchAdjacentTabIntents(
  workspaceStore: EditorWorkspaceStoreApi,
  service: FileOpenIntentService,
): () => void {
  let cancel = () => {}
  let identity = ''
  function reconcile() {
    const state = workspaceStore.getState()
    const rootPath = state.rootFolder?.path ?? null
    const group = activeEditorGroup(state.workbenchPanels.editorGroups)
    const intents: FileOpenIntent[] = []
    const paths = new Set<string>()
    for (const intent of adjacentTabIntents(state)) {
      if (paths.has(intent.path)) continue
      paths.add(intent.path)
      intents.push(intent)
    }
    const nextIdentity = JSON.stringify([rootPath, group.id, group.selectedTabId, intents])
    if (nextIdentity === identity) return
    identity = nextIdentity
    cancel()
    if (!rootPath) return
    let current = true
    const interests: FileOpenIntentInterest[] = []
    const timer = setTimeout(() => {
      void awaitEditorSyntaxWorkerIdleFences().then(
        () => {
          if (!current) return
          for (const intent of intents) {
            const interest = service.prepare({ ...intent, rootPath })
            if (!current) {
              interest.release()
              break
            }
            interests.push(interest)
          }
        },
        () => undefined,
      )
    }, ADJACENT_TAB_SETTLE_MS)
    cancel = () => {
      current = false
      clearTimeout(timer)
      const captured = interests.splice(0)
      for (const interest of captured) interest.release()
    }
  }
  const unsubscribe = workspaceStore.subscribe(reconcile)
  reconcile()
  return () => {
    unsubscribe()
    cancel()
  }
}
