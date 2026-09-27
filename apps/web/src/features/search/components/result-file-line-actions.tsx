import { memo, type RefObject } from 'react'

import { SearchResultFileLineActionRow } from '@/features/search/components/result-file-line-action-row'
import { searchResultLineActionsStyle } from '@/features/search/utils/result-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import type {
  SearchResultFileDocument,
  SearchResultFileDocumentLine,
} from '@/features/search/utils/result-view-model'

type SearchResultFileLineActionsProps = {
  canReplace?: boolean
  document: SearchResultFileDocument
  lineActionRowsRef: RefObject<Map<SearchResultId, HTMLDivElement>>
  replaceVisible: boolean
  onOpenLine: (line: SearchResultFileDocumentLine) => void
  onReplaceLine: (line: SearchResultFileDocumentLine) => void
}

export const SearchResultFileLineActions = memo(
  ({
    canReplace,
    document,
    lineActionRowsRef,
    replaceVisible,
    onOpenLine,
    onReplaceLine,
  }: SearchResultFileLineActionsProps) => {
    const lines = document.lines

    return (
      <div
        className='grid shrink-0 overflow-hidden'
        style={searchResultLineActionsStyle(lines.length)}
      >
        {lines.map((line) => (
          <SearchResultFileLineActionRow
            canReplace={canReplace}
            key={line.id}
            line={line}
            lineActionRowsRef={lineActionRowsRef}
            replaceVisible={replaceVisible}
            onOpenLine={onOpenLine}
            onReplaceLine={onReplaceLine}
          />
        ))}
      </div>
    )
  },
)
