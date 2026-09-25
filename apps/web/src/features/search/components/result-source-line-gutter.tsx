import { memo } from 'react'

import {
  searchResultFileDocumentVisibleLines,
  searchResultSourceLineGutterStyle,
} from '@/features/search/utils/result-editor'
import type { SearchResultFileDocument } from '@/features/search/utils/result-view-model'

type SearchResultSourceLineGutterProps = {
  document: SearchResultFileDocument
  minDigits: number
}

export const SearchResultSourceLineGutter = memo(
  ({ document, minDigits }: SearchResultSourceLineGutterProps) => {
    const lines = searchResultFileDocumentVisibleLines(document)

    return (
      <div
        aria-hidden='true'
        className='text-muted-foreground font-meta box-border grid shrink-0 overflow-hidden pr-2 text-right text-xs select-none'
        style={searchResultSourceLineGutterStyle(lines.length, minDigits)}
      >
        {lines.map((line) => (
          <span className='block overflow-hidden tabular-nums' key={line.id}>
            {line.sourceLine}
          </span>
        ))}
      </div>
    )
  },
)
