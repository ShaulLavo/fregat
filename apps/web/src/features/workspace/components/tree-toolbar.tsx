import { CrosshairIcon, FilePlusIcon, FolderPlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import { TreeSearchActions } from '@/features/workspace/components/tree-search-actions'

export function TreeToolbar({
  isSearchOpen,
  matchCount,
  mutationsEnabled = true,
  onClearSearch,
  onCloseSearch,
  onNewFile,
  onNewFolder,
  onNextMatch,
  onOpenSearch,
  onPreviousMatch,
  onRevealActiveFile,
  query,
}: {
  readonly isSearchOpen: boolean
  readonly matchCount: number
  readonly mutationsEnabled?: boolean
  readonly onClearSearch: () => void
  readonly onCloseSearch: () => void
  readonly onNewFile: () => void
  readonly onNewFolder: () => void
  readonly onNextMatch: () => void
  readonly onOpenSearch: () => void
  readonly onPreviousMatch: () => void
  readonly onRevealActiveFile: () => void
  readonly query: string
}) {
  return (
    <PaneBar
      aria-label='File tree actions'
      border='bottom'
      className='min-w-0 justify-between'
      role='toolbar'
    >
      <div className='flex shrink-0 items-center gap-0.5'>
        <Button
          aria-label='New file at workspace root'
          disabled={!mutationsEnabled}
          size='icon-xs'
          title='New File'
          type='button'
          variant='ghost'
          onClick={onNewFile}
        >
          <FilePlusIcon className='size-3.5' />
        </Button>
        <Button
          aria-label='New folder at workspace root'
          disabled={!mutationsEnabled}
          size='icon-xs'
          title='New Folder'
          type='button'
          variant='ghost'
          onClick={onNewFolder}
        >
          <FolderPlusIcon className='size-3.5' />
        </Button>
      </div>

      <div className='flex min-w-0 items-center justify-end gap-0.5'>
        <TreeSearchActions
          isOpen={isSearchOpen}
          matchCount={matchCount}
          query={query}
          onClear={onClearSearch}
          onClose={onCloseSearch}
          onNext={onNextMatch}
          onOpen={onOpenSearch}
          onPrevious={onPreviousMatch}
        />
        <Button
          aria-label='Reveal active file in tree'
          size='icon-xs'
          title='Reveal Active File'
          type='button'
          variant='ghost'
          onClick={onRevealActiveFile}
        >
          <CrosshairIcon className='size-3.5' />
        </Button>
      </div>
    </PaneBar>
  )
}
