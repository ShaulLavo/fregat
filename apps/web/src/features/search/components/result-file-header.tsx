import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { FileLabel } from '@/components/file-label'
import { CaretRightIcon } from '@phosphor-icons/react'
import { memo } from 'react'

import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { matchNoun } from '@/features/search/utils/match-noun'
import type { SearchResultFileBlock } from '@/features/search/utils/result-view-model'

type SearchResultFileHeaderProps = {
  active: boolean
  canReplace?: boolean
  file: SearchResultFileBlock
  replaceVisible: boolean
}

export const SearchResultFileHeader = memo(
  ({ active, canReplace, file, replaceVisible }: SearchResultFileHeaderProps) => {
    const { replacePath, toggleGroup } = useSearchResultActions()
    const handleReplace = () => replacePath(file.path)
    const handleToggle = () => toggleGroup(file.path)

    return (
      <ListRow
        role='presentation'
        selected={active}
        title={file.path}
        className='grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] text-left'
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={file.collapsed ? 'Expand file results' : 'Collapse file results'}
                className='text-muted-foreground'
                disabled={file.excerpts.length === 0}
                focusableWhenDisabled
                size='icon-xs'
                tabIndex={-1}
                type='button'
                variant='ghost'
                onClick={handleToggle}
              >
                <CaretRightIcon
                  className={cn(
                    'size-(--icon-size-sm) transition-transform',
                    !file.collapsed && file.excerpts.length > 0 && 'rotate-90',
                  )}
                />
              </Button>
            }
          />
          <TooltipContent>
            {file.collapsed ? 'Expand file results' : 'Collapse file results'}
          </TooltipContent>
        </Tooltip>
        <div className='grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5 text-left'>
          <FileLabel className='text-xs' iconClassName='size-(--icon-size)' path={file.pathLabel} />
        </div>
        <span className='bg-muted/55 text-muted-foreground text-3xs rounded-md px-1.5 leading-4 tabular-nums'>
          {file.matchCount.toLocaleString()} {matchNoun(file.matchCount)}
        </span>
        {replaceVisible ? (
          <Button
            className='text-3xs px-1.5'
            disabled={!canReplace}
            size='xs'
            title='Replace matches in this file'
            type='button'
            variant='ghost'
            onClick={handleReplace}
          >
            Replace
          </Button>
        ) : null}
      </ListRow>
    )
  },
)
