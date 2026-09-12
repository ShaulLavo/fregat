import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { handleSearchResultSurfaceKeyDown } from '@/features/search/utils/result-editor-keyboard'
import { searchResultItems } from '@/features/search/utils/result-items'
import { handleSearchResultKeyDown } from '@/features/search/utils/result-sidebar-keyboard'
import type { SearchResultKeyEvent } from '@/features/search/utils/result-tree-keyboard'
import {
  searchResultFileBlocks,
  searchResultVirtualRows,
} from '@/features/search/utils/result-view-model'

export function searchResultGroup(
  overrides: Partial<WorkspaceSearchFileGroup> = {},
): WorkspaceSearchFileGroup {
  return {
    collapsed: false,
    count: 1,
    matches: [
      {
        kind: 'content',
        source: 'disk',
        type: 'file',
        path: '/repo/src/app.ts',
        line: 12,
        column: 14,
        endColumn: 20,
        preview: 'export const needle = true',
      },
    ],
    name: 'app.ts',
    path: '/repo/src/app.ts',
    pathLabel: 'src/app.ts',
    ...overrides,
  }
}

export function searchResultKeyEvent(
  key: string,
  modifiers: Partial<
    Pick<SearchResultKeyEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
  > = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

export function searchKeyboardHarness(
  kind: 'sidebar' | 'editor',
  groups: readonly WorkspaceSearchFileGroup[] = [searchResultGroup()],
) {
  const items = searchResultItems(groups)
  const blocks = searchResultFileBlocks(groups, 'needle')
  const rows = searchResultVirtualRows(blocks)
  const actions: unknown[] = []
  const onSelectResult = (id: string | null) => {
    actions.push(['select', id])
  }
  const onToggleGroup = (path: string) => {
    actions.push(['toggle', path])
  }
  return {
    items,
    blocks,
    rows,
    actions,
    press(event: SearchResultKeyEvent, activeResultId: string | null) {
      if (kind === 'sidebar') {
        handleSearchResultKeyDown({
          activeResultId,
          event,
          items,
          onSelectResult,
          onToggleGroup,
          onOpenMatch: (match) => {
            actions.push(['open', match])
          },
        })
        return
      }
      handleSearchResultSurfaceKeyDown({
        activeResultId,
        event,
        blocks,
        rows,
        onSelectResult,
        onToggleGroup,
        onOpenTarget: (target) => {
          actions.push(['open', target])
        },
      })
    },
  }
}
