import { filesystemPath } from '@/lib/documents/utils/identity'
import { useCallback, useMemo } from 'react'
import type { WorkspaceSearchMatch } from '@workspace/contracts'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import {
  SearchResultActionsContext,
  type SearchResultActions,
} from '@/features/search/providers/result-actions-context'
import { openWorkspaceSearchMatch } from '@/features/search/utils/open-match'
import { SearchResultsView } from '@/features/search/components/results-view'
import { SearchResultEditorSurface } from '@/features/search/components/result-editor-surface'
import { SearchBufferStatus } from '@/features/search/components/buffer-status'
import {
  useSearchBufferState,
  type WorkspaceSearchFileGroup,
} from '@/features/search/state/buffer-state'
import { useSearchBufferResults } from '@/features/search/hooks/use-buffer-results'
import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import type { SearchResultOpenTarget } from '@/features/search/utils/result-view-model'

export function SearchResults({
  compact = true,

  rootPath,
}: {
  readonly compact?: boolean

  readonly rootPath: string
}) {
  const { activeResultId, groups, replaceText, replaceVisible, resultsQuery, resultsSearchQuery } =
    useSearchBufferResults(rootPath)
  const { canReplace, replaceGroup, replaceMatch } = useWorkspaceSearchReplace(
    rootPath,
    replaceVisible,
  )
  const commands = useEditorCommands()
  const selectResult = useSearchBufferState((state) => state.selectResult)
  const toggleGroup = useSearchBufferState((state) => state.toggleGroup)
  const groupByPath = useMemo(() => searchResultGroupByPath(groups), [groups])
  const handleOpenMatch = useCallback(
    (match: WorkspaceSearchMatch) => openWorkspaceSearchMatch(match, resultsQuery, commands),
    [commands, resultsQuery],
  )
  const handleOpenTarget = useCallback(
    (target: SearchResultOpenTarget) => {
      if (!target.match) {
        commands.openFileSurface(filesystemPath(target.path))
        return
      }

      openWorkspaceSearchMatch(target.match, resultsQuery, commands)
    },
    [commands, resultsQuery],
  )
  const replacePath = useCallback(
    (path: string) => {
      const group = groupByPath.get(path)
      if (!group) return

      replaceGroup(group)
    },
    [groupByPath, replaceGroup],
  )
  // Search renderers are memoized; keep domain actions stable across unrelated result renders.
  const actions = useMemo<SearchResultActions>(
    () => ({
      openMatch: handleOpenMatch,
      openTarget: handleOpenTarget,
      replaceGroup,
      replaceMatch,
      replacePath,
      selectResult,
      selectResultWithoutReveal: selectResult,
      toggleGroup,
    }),
    [
      handleOpenMatch,
      handleOpenTarget,
      replaceGroup,
      replaceMatch,
      replacePath,
      selectResult,
      toggleGroup,
    ],
  )

  if (groups.length === 0) {
    return <SearchBufferStatus rootPath={rootPath} />
  }

  if (!compact) {
    return (
      <SearchResultActionsContext value={actions}>
        <SearchResultEditorSurface
          activeResultId={activeResultId}
          canReplace={replaceVisible ? canReplace : false}
          displayedResultsQuery={resultsSearchQuery?.query ?? null}
          groups={groups}
          replaceVisible={Boolean(replaceVisible)}
          resultsQuery={resultsQuery}
          rootPath={rootPath}
        />
      </SearchResultActionsContext>
    )
  }

  return (
    <SearchResultActionsContext value={actions}>
      <SearchResultsView
        activeResultId={activeResultId}
        canReplace={replaceVisible ? canReplace : false}
        compact={compact}
        error={null}
        groups={groups}
        query={resultsQuery}
        replaceText={replaceText}
        replaceVisible={replaceVisible}
        resultsSearchQuery={resultsSearchQuery}
        status='ready'
      />
    </SearchResultActionsContext>
  )
}

function searchResultGroupByPath(groups: readonly WorkspaceSearchFileGroup[]) {
  return new Map(groups.map((group) => [group.path, group]))
}
