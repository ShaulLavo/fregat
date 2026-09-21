import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { memo, useEffect, useRef, type MouseEvent, type RefObject } from 'react'

import {
  searchResultLineActionClassName,
  searchResultLineOpenLabel,
} from '@/features/search/utils/result-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import type { SearchResultFileDocumentLine } from '@/features/search/utils/result-view-model'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

type SearchResultFileLineActionRowProps = {
  canReplace?: boolean
  line: SearchResultFileDocumentLine
  lineActionRowsRef: RefObject<Map<SearchResultId, HTMLDivElement>>
  replaceVisible: boolean
  onOpenLine: (line: SearchResultFileDocumentLine) => void
  onReplaceLine: (line: SearchResultFileDocumentLine) => void
}

export const SearchResultFileLineActionRow = memo(
  ({
    canReplace,
    line,
    lineActionRowsRef,
    replaceVisible,
    onOpenLine,
    onReplaceLine,
  }: SearchResultFileLineActionRowProps) => {
    const rowRef = useRef<HTMLDivElement | null>(null)
    const openLabel = searchResultLineOpenLabel(line)

    useEffect(() => {
      const row = rowRef.current
      if (!row) return

      const rows = lineActionRowsRef.current
      rows.set(line.id, row)

      return () => {
        if (rows.get(line.id) !== row) return

        rows.delete(line.id)
      }
    }, [line.id, lineActionRowsRef])

    const handleOpenClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onOpenLine(line)
    }

    const handleReplaceClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      onReplaceLine(line)
    }

    return (
      <div
        className='group/search-result-line-action-row flex items-center justify-end gap-0.5'
        ref={rowRef}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={openLabel}
                className={searchResultLineActionClassName()}
                size='icon-xs'
                type='button'
                variant='ghost'
                onClick={handleOpenClick}
              >
                <ArrowSquareOutIcon className='size-(--icon-size-sm)' />
              </Button>
            }
          />
          <TooltipContent>{openLabel}</TooltipContent>
        </Tooltip>
        {replaceVisible ? (
          <Button
            className={cn('h-5 px-1.5 text-3xs', searchResultLineActionClassName())}
            disabled={!canReplace}
            size='xs'
            title='Replace this match'
            type='button'
            variant='ghost'
            onClick={handleReplaceClick}
          >
            Replace
          </Button>
        ) : null}
      </div>
    )
  },
)
