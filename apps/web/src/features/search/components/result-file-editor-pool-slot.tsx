import type { EditorTheme } from '@singapore-editor/core/rendering'
import { memo, useState } from 'react'

import { SEARCH_RESULT_FILE_EDITOR_POOL_HIDDEN_STYLE } from '@/features/search/utils/result-editor-constants'
import type { SearchResultFileEditorPoolEntry } from '@/features/search/utils/result-editor-types'
import {
  equalSearchResultFileEditorLineWindow,
  searchResultFileContainsId,
  searchResultFileEditorLineWindow,
  searchResultVirtualRowStyle,
} from '@/features/search/utils/result-editor'
import { searchResultDomId } from '@/features/search/utils/result-dom-id'
import { SearchResultFileEditor } from '@/features/search/components/result-file-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import { searchResultVirtualRowId } from '@/features/search/utils/result-view-model'
import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'

type SearchResultFileEditorPoolSlotProps = {
  activeResultId: SearchResultId | null
  canReplace?: boolean
  editorTheme: EditorTheme
  entry: SearchResultFileEditorPoolEntry

  replaceVisible: boolean
  treeId: string
  viewport: SearchResultVirtualListViewport
}

export const SearchResultFileEditorPoolSlot = memo(
  ({
    activeResultId,
    canReplace,
    editorTheme,
    entry,

    replaceVisible,
    treeId,
    viewport,
  }: SearchResultFileEditorPoolSlotProps) => {
    const { item, visible } = entry
    const row = item.row
    const file = row.file
    const id = searchResultVirtualRowId(row)
    const active = visible && searchResultFileContainsId(file, activeResultId)
    const nextLineWindow = searchResultFileEditorLineWindow({
      lineCount: file.excerpts.length,
      virtualItem: item.virtualItem,
      viewport,
    })
    // An equal window must keep its identity, or the editor below re-renders on every scroll
    // frame. React re-runs this render with the new state before it commits anything.
    const [lineWindow, setLineWindow] = useState(nextLineWindow)
    if (!equalSearchResultFileEditorLineWindow(lineWindow, nextLineWindow))
      setLineWindow(nextLineWindow)
    const renderEditor = lineWindow.end > lineWindow.start

    return (
      <div
        aria-hidden={visible ? undefined : true}
        aria-level={visible ? 2 : undefined}
        aria-selected={visible ? active : undefined}
        className='absolute right-2 left-2'
        data-index={visible ? item.virtualItem.index : undefined}
        id={id && visible ? searchResultDomId(treeId, id) : undefined}
        role={visible ? 'treeitem' : undefined}
        style={
          visible
            ? searchResultVirtualRowStyle(item.virtualItem)
            : SEARCH_RESULT_FILE_EDITOR_POOL_HIDDEN_STYLE
        }
      >
        {renderEditor ? (
          <SearchResultFileEditor
            activeResultId={active ? activeResultId : null}
            canReplace={canReplace}
            editorTheme={editorTheme}
            file={file}
            lineWindow={lineWindow}
            replaceVisible={replaceVisible}
          />
        ) : null}
      </div>
    )
  },
)
