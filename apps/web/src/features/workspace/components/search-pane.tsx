import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { memo, useRef } from 'react'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { SearchSummaryActions } from '@/features/search/components/summary-actions'
import { SearchSummaryText } from '@/features/search/components/summary-text'
import { ToolPaneHeader } from '@/components/tool-pane-header'
import { SearchControls } from '@/features/workspace/components/search-controls'
import { SearchResults } from '@/features/workspace/components/search-results'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export const SearchPane = memo(
  ({
    compact = true,

    rootPath,
  }: {
    readonly compact?: boolean

    readonly rootPath: string
  }) => {
    const rootRef = useRef<HTMLElement | null>(null)
    const { openSearchEditor } = useEditorCommands()
    const { ref: focusTargetRef } = useFocusTarget<HTMLElement>({
      area: 'search',
      id: { kind: 'search', rootPath, surface: compact ? 'sidebar' : 'editor' },
      onIntent: (intent) => {
        if (intent !== 'focus') return false

        const input = rootRef.current?.querySelector<HTMLInputElement>(
          'input[aria-label="Search workspace"]',
        )
        if (!input) return false

        input.focus()
        return true
      },
    })
    // Stable identity keeps the parent target mounted while nested editors register deeper.
    const setRootRef = (element: HTMLElement | null) => {
      rootRef.current = element
      focusTargetRef(element)
    }

    return (
      <ToolPane
        className={cn('h-full min-w-0 overflow-hidden', !compact && 'bg-background')}
        bodyClassName='flex flex-col'
        scroll={false}
        ref={setRootRef}
        header={
          compact ? (
            <ToolPaneHeader
              actions={
                <>
                  <SearchSummaryActions rootPath={rootPath} />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label='Open search editor'
                          className='text-muted-foreground hover:text-foreground'
                          size='icon-sm'
                          type='button'
                          variant='ghost'
                          onClick={() => openSearchEditor(filesystemPath(rootPath))}
                        >
                          <ArrowSquareOutIcon className='size-(--icon-size-sm)' />
                        </Button>
                      }
                    />
                    <TooltipContent>{'Open search editor'}</TooltipContent>
                  </Tooltip>
                </>
              }
              detail={<SearchSummaryText rootPath={rootPath} />}
              tab='search'
            />
          ) : null
        }
        subheader={<SearchControls compact={compact} rootPath={rootPath} />}
      >
        <SearchResults compact={compact} rootPath={rootPath} />
      </ToolPane>
    )
  },
)
