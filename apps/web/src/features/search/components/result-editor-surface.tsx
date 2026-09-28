import { useRowHeight } from '@workspace/ui/patterns/use-row-height'
import { createSearchResultVirtualListMetrics } from '@/features/search/utils/result-virtual-list'
import {
  memo,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { isContextMenuKey } from '@workspace/utils/keyboard'
import { useListContextMenu } from '@/keymap/menus/hooks/use-list-context-menu'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useActiveRowFileIntent } from '@/lib/file-open-intent/hooks/use-active-row-file-intent'
import { SearchFileMenu } from '@/features/search/components/file-menu'
import { SearchFileMenuContext } from '@/features/search/providers/file-menu-context'

import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
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
  searchResultVirtualRowInputs,
  scrollActiveSearchResultIntoView,
  searchResultVirtualRowIndex,
  searchResultVirtualRowScrollTarget,
} from '@/features/search/utils/result-editor'
import { searchResultDomId } from '@/features/search/utils/result-dom-id'
import { SearchResultEditorVirtualWindow } from '@/features/search/components/result-editor-virtual-window'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  searchResultFileBlocks,
  searchResultOpenTargetForId,
  searchResultVirtualRowById,
  type SearchResultOpenTarget,
  searchResultVirtualRowId,
  searchResultVirtualRows,
} from '@/features/search/utils/result-view-model'

type SearchResultEditorSurfaceProps = {
  activeResultId: SearchResultId | null
  activeResultPicked: boolean
  canReplace?: boolean
  displayedResultsQuery: string | null
  groups: readonly WorkspaceSearchFileGroup[]

  replaceVisible: boolean
  resultsQuery: string
  rootPath: string
}

const noopScrollToIndex: SearchResultEditorScrollToIndex = () => {}
const noopScrollToOffset = () => {}

export const SearchResultEditorSurface = memo(
  ({
    activeResultId,
    activeResultPicked,
    canReplace,
    displayedResultsQuery,
    groups,

    replaceVisible,
    resultsQuery,
    rootPath,
  }: SearchResultEditorSurfaceProps) => {
    const actions = useSearchResultActions()
    const treeId = useId()
    const parentRef = useRef<HTMLDivElement | null>(null)
    const blocks = searchResultFileBlocks(groups, resultsQuery)
    // Manual memo: `rows` is a useMemo dependency, and the compiler's cache is a
    // cache, not an identity guarantee — when it recomputes, the useMemo re-runs.
    const rows = useMemo(() => searchResultVirtualRows(blocks), [groups, resultsQuery])
    const activeRow = useMemo(
      () => searchResultVirtualRowById(rows, activeResultId),
      [activeResultId, rows],
    )
    // Manual memo: `activeIndex` is a useLayoutEffect dependency, and the compiler's cache is a
    // cache, not an identity guarantee — when it recomputes, the useLayoutEffect re-runs.
    const activeIndex = useMemo(
      () => searchResultVirtualRowIndex(rows, activeResultId),
      [activeResultId, rows],
    )
    // Manual memo: `activeScrollTarget` is a useLayoutEffect dependency, and the compiler's cache is a
    // cache, not an identity guarantee — when it recomputes, the useLayoutEffect re-runs.
    const activeScrollTarget = useMemo(
      () => searchResultVirtualRowScrollTarget(activeRow, activeResultId),
      [activeResultId, activeRow],
    )
    useActiveRowFileIntent(activeRow ? filesystemPath(activeRow.file.path) : null, 'search')
    const suppressNextActiveRevealRef = useRef(false)
    const previousActiveResultIdRef = useRef(activeResultId)
    const activeIndexRef = useRef(activeIndex)
    const activeScrollTargetRef = useRef(activeScrollTarget)
    const scrollToIndexRef = useRef<SearchResultEditorScrollToIndex>(noopScrollToIndex)
    const scrollToOffsetRef = useRef<(offset: number) => void>(noopScrollToOffset)
    const { editorTheme } = useEditorColorTheme()
    const contextMenu = useListContextMenu<SearchResultOpenTarget>({
      containerRef: parentRef,
      isTargetPresent: (target) =>
        blocks.some(
          (block) =>
            block.path === target.path &&
            (target.match === null ||
              block.excerpts.some(
                (excerpt) =>
                  excerpt.sourceMatch.line === target.match?.line &&
                  excerpt.sourceMatch.column === target.match?.column,
              )),
        ),
    })
    const menuTarget = contextMenu.target
    const menuPath = groups.find((group) => group.path === menuTarget?.path)?.pathLabel
    const selectResultWithoutReveal = (id: SearchResultId | null) => {
      if (id === activeResultId) return

      suppressNextActiveRevealRef.current = true
      actions.selectResult(id)
    }
    // The editor surface changes selection reveal semantics for editor-pool interactions.
    const editorActions: SearchResultActions = {
      ...actions,
      selectResultWithoutReveal,
    }

    useLayoutEffect(() => {
      activeIndexRef.current = activeIndex
      activeScrollTargetRef.current = activeScrollTarget
    }, [activeIndex, activeScrollTarget])

    useLayoutEffect(() => {
      if (previousActiveResultIdRef.current === activeResultId) return
      previousActiveResultIdRef.current = activeResultId
      // The default cursor follows streaming results and must not drag the view with it.
      if (!activeResultId || !activeResultPicked) return
      if (suppressNextActiveRevealRef.current) {
        suppressNextActiveRevealRef.current = false
        return
      }

      scrollActiveSearchResultIntoView({
        activeIndexRef,
        activeScrollTargetRef,
        scrollToIndexRef,
      })
    }, [activeResultId, activeResultPicked])

    const rowHeight = useRowHeight(parentRef)
    const geometry = createSearchResultVirtualListMetrics(
      searchResultVirtualRowInputs(rows, rowHeight),
    ).items
    const initialViewport = useSearchResultScrollPosition({
      displayedResultsQuery,
      geometry,
      parentRef,
      rootPath,
      scrollToOffsetRef,
    })

    function openFileMenu(target: SearchResultOpenTarget, event: MouseEvent<HTMLElement>) {
      contextMenu.openAtEvent(target, event)
    }

    function openActiveMenu(event: KeyboardEvent<HTMLDivElement>) {
      const target = searchResultOpenTargetForId(blocks, activeResultId)
      const row = activeRow
        ? document.getElementById(searchResultDomId(treeId, searchResultVirtualRowId(activeRow)))
        : null
      if (!target) return
      contextMenu.openOnMenuKey(event, target, row)
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (isContextMenuKey(event)) return openActiveMenu(event)
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
        {...contextMenu.containerProps}
        aria-activedescendant={
          activeRow ? searchResultDomId(treeId, searchResultVirtualRowId(activeRow)) : undefined
        }
        aria-label='Search result editor'
        className='min-h-0 overflow-x-hidden overflow-y-auto'
        ref={parentRef}
        role='tree'
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <SearchResultActionsContext value={editorActions}>
          <SearchFileMenuContext value={openFileMenu}>
            <SearchResultEditorVirtualWindow
              activeResultId={activeResultId}
              canReplace={canReplace}
              editorTheme={editorTheme}
              initialViewport={initialViewport}
              parentRef={parentRef}
              replaceVisible={replaceVisible}
              rows={rows}
              scrollToIndexRef={scrollToIndexRef}
              scrollToOffsetRef={scrollToOffsetRef}
              treeId={treeId}
            />
          </SearchFileMenuContext>
          {contextMenu.anchor && menuTarget ? (
            <SearchFileMenu
              anchor={contextMenu.anchor}
              relativePath={menuPath ?? menuTarget.path}
              returnFocusTo={contextMenu.returnFocusTo}
              target={menuTarget}
              onOpenChange={contextMenu.onOpenChange}
            />
          ) : null}
        </SearchResultActionsContext>
      </div>
    )
  },
)
SearchResultEditorSurface.displayName = 'SearchResultEditorSurface'
