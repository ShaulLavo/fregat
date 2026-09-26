import { useDebouncedValue } from '@tanstack/react-pacer/debouncer'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useHistory } from '@/features/git/hooks/use-history'
import { useStatus } from '@/features/git/hooks/use-status'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'

export function usePanelRoot<T extends string>(root: T, enabled = true): T {
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const status = useStatus(enabled ? root : null)
  const graph = enabled && panels.activeGitTab === 'graph'
  const { refName, search, pageCount } = panels.gitHistory
  const [settledSearch] = useDebouncedValue(search.trim(), { wait: 200 })
  const history = useHistory(root, refName, settledSearch, pageCount, graph)
  const historyReady = !history.isPending && !history.isPlaceholderData && !history.isRestoring
  // The branch header and retained graph must advance to the same root in one render.
  const ready = !status.isPending && (!graph || status.isError || historyReady)
  return useHeldUntilReady(root, !enabled || ready)
}
