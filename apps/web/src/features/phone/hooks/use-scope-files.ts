import type { GitFileStatus } from '@workspace/contracts'

import { useNavigation } from '@/hooks/use-navigation'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { useStatus } from '@/features/git/hooks/use-status'
import { changeRows } from '@/features/git/utils/change-rows'
import { neighbours } from '@/features/phone/utils/neighbours'

const NO_GIT_FILES: readonly GitFileStatus[] = []

type ScopeFiles = {
  readonly count: number
  readonly index: number
  readonly next: (() => void) | null
  readonly previous: (() => void) | null
}

/**
 * The open diff's place among the files of the scope it came from, a turn or the working tree,
 * and the steps to the files either side. A step replaces the history entry, so Back leaves the
 * file screen instead of walking the files. Null for anything else.
 */
export function useScopeFiles(
  diffScope: ReturnType<typeof useSessionDiffScope>,
): ScopeFiles | null {
  const selected = useEditorWorkspaceState((state) => state.selectedTabContent)
  const owner = useEditorWorkspaceStoreApi()
  const navigation = useNavigation()
  const files = useStatus(useSessionToolRoot()).data?.files ?? NO_GIT_FILES
  const source =
    selected?.kind === 'document' && selected.document.kind === 'git-diff'
      ? selected.document.source
      : null

  if (source?.kind === 'snapshot' && source.target.kind === 'moving') {
    const { staged, worktree } = changeRows(files)
    const rows = staged.concat(worktree)
    const found = neighbours(
      rows,
      (row) =>
        source.target.kind === 'moving' &&
        row.file.path === source.target.path &&
        row.section === source.target.changeSource,
    )
    if (!found) return null
    const { next, previous } = found
    return {
      ...found,
      next: next
        ? () =>
            void navigation.openDiff({
              owner,
              rootPath: source.target.rootPath,
              row: next,
              replace: true,
            })
        : null,
      previous: previous
        ? () =>
            void navigation.openDiff({
              owner,
              rootPath: source.target.rootPath,
              row: previous,
              replace: true,
            })
        : null,
    }
  }
  if (source?.kind !== 'checkpoint-file' || !diffScope.turnSummary) return null

  const paths = diffScope.turnSummary.files.map((file) => file.path)
  const found = neighbours(paths, (path) => path === source.file.path)
  if (!found) return null
  const { next, previous } = found
  return {
    ...found,
    next: next ? () => diffScope.openTurnFile(next, true) : null,
    previous: previous ? () => diffScope.openTurnFile(previous, true) : null,
  }
}
