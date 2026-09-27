import type { EditorTheme } from '@singapore-editor/core/rendering'
import { memo, useLayoutEffect, useRef } from 'react'

import { SEARCH_RESULT_FILE_EDITOR_POOL_HIDDEN_STYLE } from '@/features/search/utils/result-editor-constants'
import type { SearchResultFileEditorSlot } from '@/features/search/utils/result-editor-types'
import {
  searchResultFileContainsId,
  searchResultVirtualRowStyle,
} from '@/features/search/utils/result-editor'
import { searchResultDomId } from '@/features/search/utils/result-dom-id'
import { SearchResultFileEditor } from '@/features/search/components/result-file-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import { searchResultVirtualRowId } from '@/features/search/utils/result-view-model'

type SearchResultFileEditorPoolSlotProps = {
  activeResultId: SearchResultId | null
  canReplace?: boolean
  editorTheme: EditorTheme
  slot: SearchResultFileEditorSlot
  replaceVisible: boolean
  treeId: string
}

export const SearchResultFileEditorPoolSlot = memo(
  ({
    activeResultId,
    canReplace,
    editorTheme,
    slot,
    replaceVisible,
    treeId,
  }: SearchResultFileEditorPoolSlotProps) => {
    const { item, lineWindow, visible } = slot
    const row = item.row
    const file = row.file
    const id = searchResultVirtualRowId(row)
    const active = visible && searchResultFileContainsId(file, activeResultId)
    const slotRef = useRef<HTMLDivElement | null>(null)

    // A parked editor keeps its DOM for the next file, so focus inside it would type into a hidden view.
    useLayoutEffect(() => {
      const element = slotRef.current
      if (visible || !element?.contains(document.activeElement)) return

      element.closest<HTMLElement>('[role="tree"]')?.focus()
    }, [visible])

    return (
      <div
        aria-hidden={visible ? undefined : true}
        aria-level={visible ? 2 : undefined}
        aria-selected={visible ? active : undefined}
        className='absolute right-2 left-2'
        data-index={visible ? item.virtualItem.index : undefined}
        id={id && visible ? searchResultDomId(treeId, id) : undefined}
        ref={slotRef}
        role={visible ? 'treeitem' : undefined}
        style={
          visible
            ? searchResultVirtualRowStyle(item.virtualItem)
            : SEARCH_RESULT_FILE_EDITOR_POOL_HIDDEN_STYLE
        }
      >
        <SearchResultFileEditor
          activeResultId={active ? activeResultId : null}
          canReplace={canReplace}
          editorTheme={editorTheme}
          file={file}
          lineWindow={lineWindow}
          parked={!visible}
          replaceVisible={replaceVisible}
        />
      </div>
    )
  },
)
