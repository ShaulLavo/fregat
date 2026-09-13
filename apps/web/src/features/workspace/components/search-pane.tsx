import { filesystemPath } from '@/lib/documents/utils/identity'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { memo, useCallback, useRef } from 'react'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { SearchSummaryActions } from '@/features/search/components/summary-actions'
import { SearchSummaryText } from '@/features/search/components/summary-text'
import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'
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
    const setRootRef = useCallback(
      (element: HTMLElement | null) => {
        rootRef.current = element
        focusTargetRef(element)
      },
      [focusTargetRef],
    )

    return (
      <section
        className='grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden'
        ref={setRootRef}
      >
        {compact ? (
          <ToolPaneHeader
            actions={
              <>
                <SearchSummaryActions rootPath={rootPath} />
                <Button
                  aria-label='Open search editor'
                  className='text-muted-foreground hover:text-foreground'
                  size='icon-sm'
                  title='Open search editor'
                  type='button'
                  variant='ghost'
                  onClick={() => openSearchEditor(filesystemPath(rootPath))}
                >
                  <ArrowSquareOutIcon className='size-3.5' />
                </Button>
              </>
            }
            detail={<SearchSummaryText rootPath={rootPath} />}
            tab='search'
          />
        ) : (
          <div />
        )}
        <SearchControls compact={compact} rootPath={rootPath} />
        <SearchResults compact={compact} rootPath={rootPath} />
      </section>
    )
  },
)
