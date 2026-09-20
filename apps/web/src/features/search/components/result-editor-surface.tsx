import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from 'react'

import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import { useSearchResultScrollPosition } from '@/features/search/hooks/use-result-scroll-position'
import {
  SearchResultActionsContext,
  type SearchResultActions,
} from '@/features/search/providers/result-actions-context'
import { handleSearchResultSurfaceKeyDown } from '@/features/search/utils/result-editor-keyboard'
import type { SearchResultEditorScrollToIndex } from '@/features/search/utils/result-editor-types'
import {
  scrollActiveSearchResultIntoView,
  searchResultVirtualRowIndex,
  searchResultVirtualRowScrollTarget,
} from '@/features/search/utils/result-editor'
import { searchResultDomId } from '@/features/search/utils/result-dom-id'
import { SearchResultEditorVirtualWindow } from '@/features/search/components/result-editor-virtual-window'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  searchResultFileBlocks,
  searchResultVirtualRowById,
  searchResultVirtualRowId,
  searchResultVirtualRows,
} from '@/features/search/utils/result-view-model'

type SearchResultEditorSurfaceProps = {
  activeResultId: SearchResultId | null
  canReplace?: boolean
  displayedResultsQuery: string | null
  groups: readonly WorkspaceSearchFileGroup[]

  prewarmEditorPool?: boolean
  replaceVisible: boolean
  resultsQuery: string
  rootPath: string
}

const noopScrollToIndex: SearchResultEditorScrollToIndex = () => {}
const noopScrollToOffset = () => {}

export const SearchResultEditorSurface = memo(
  ({
    activeResultId,
    canReplace,
    displayedResultsQuery,
    groups,

    prewarmEditorPool = true,
    replaceVisible,
    resultsQuery,
    rootPath,
  }: SearchResultEditorSurfaceProps) => {
    const actions = useSearchResultActions()
    const treeId = useId()
    const parentRef = useRef<HTMLDivElement | null>(null)
    const blocks = useMemo(
      () => searchResultFileBlocks(groups, resultsQuery),
      [groups, resultsQuery],
    )
    const rows = useMemo(() => searchResultVirtualRows(blocks), [blocks])
    const activeRow = useMemo(
      () => searchResultVirtualRowById(rows, activeResultId),
      [activeResultId, rows],
    )
    const activeIndex = useMemo(
      () => searchResultVirtualRowIndex(rows, activeResultId),
      [activeResultId, rows],
    )
    const activeScrollTarget = useMemo(
      () => searchResultVirtualRowScrollTarget(activeRow, activeResultId),
      [activeResultId, activeRow],
    )
    const suppressNextActiveRevealRef = useRef(false)
    const previousActiveResultIdRef = useRef(activeResultId)
    const activeIndexRef = useRef(activeIndex)
    const activeScrollTargetRef = useRef(activeScrollTarget)
    const scrollToIndexRef = useRef<SearchResultEditorScrollToIndex>(noopScrollToIndex)
    const scrollToOffsetRef = useRef<(offset: number) => void>(noopScrollToOffset)
    const { editorTheme } = useEditorColorTheme()
    const selectResultWithoutReveal = useCallback(
      (id: SearchResultId | null) => {
        if (id === activeResultId) return

        suppressNextActiveRevealRef.current = true
        actions.selectResult(id)
      },
      [actions, activeResultId],
    )
    // The editor surface changes selection reveal semantics for editor-pool interactions.
    const editorActions = useMemo<SearchResultActions>(
      () => ({
        ...actions,
        selectResultWithoutReveal,
      }),
      [actions, selectResultWithoutReveal],
    )

    useLayoutEffect(() => {
      activeIndexRef.current = activeIndex
      activeScrollTargetRef.current = activeScrollTarget
    }, [activeIndex, activeScrollTarget])

    useLayoutEffect(() => {
      if (previousActiveResultIdRef.current === activeResultId) return
      previousActiveResultIdRef.current = activeResultId
      if (!activeResultId) return
      if (suppressNextActiveRevealRef.current) {
        suppressNextActiveRevealRef.current = false
        return
      }

      scrollActiveSearchResultIntoView({
        activeIndexRef,
        activeScrollTargetRef,
        scrollToIndexRef,
      })
    }, [activeResultId])

    const initialViewport = useSearchResultScrollPosition({
      displayedResultsQuery,
      parentRef,
      rootPath,
      scrollToOffsetRef,
    })

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      handleSearchResultSurfaceKeyDown({
        activeResultId,
        blocks,
        event,
        onOpenTarget: actions.openTarget,
        onSelectResult: actions.selectResult,
        onToggleGroup: actions.toggleGroup,
        rows,
      })
    }

    return (
      <div
        aria-activedescendant={
          activeRow ? searchResultDomId(treeId, searchResultVirtualRowId(activeRow)) : undefined
        }
        aria-label='Search result editor'
        className='app-scrollbar-thin min-h-0 overflow-x-hidden overflow-y-auto'
        ref={parentRef}
        role='tree'
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <SearchResultActionsContext value={editorActions}>
          <SearchResultEditorVirtualWindow
            activeResultId={activeResultId}
            canReplace={canReplace}
            editorTheme={editorTheme}
            initialViewport={initialViewport}
            parentRef={parentRef}
            prewarmEditorPool={prewarmEditorPool}
            replaceVisible={replaceVisible}
            rows={rows}
            scrollToIndexRef={scrollToIndexRef}
            scrollToOffsetRef={scrollToOffsetRef}
            treeId={treeId}
          />
        </SearchResultActionsContext>
      </div>
    )
  },
)
SearchResultEditorSurface.displayName = 'SearchResultEditorSurface'
