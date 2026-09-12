import { filesystemPath } from '@/lib/documents/utils/identity'
import { ArrowSquareOutIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

import { SearchSummary } from '@/features/workspace/components/search-summary'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { SearchFilterFields } from '@/features/search/components/filter-fields'
import { SearchHistoryInput } from '@/features/search/components/history-input'
import { SearchModeButtons } from '@/features/search/components/mode-buttons'
import { SearchReplaceFields } from '@/features/search/components/replace-fields'
import { SearchReplaceToggleButton } from '@/features/search/components/replace-toggle-button'
import { useSearchBufferInputs } from '@/features/search/hooks/use-buffer-inputs'
import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import { Button } from '@workspace/ui/components/button'

export function SearchControls({
  rootPath,
  showOpenInEditorButton = true,
}: {
  rootPath: string
  showOpenInEditorButton?: boolean
}) {
  const {
    query,
    replaceText,
    replaceVisible,
    replacing,
    searchOptions,
    selectNextQuery,
    selectNextReplaceText,
    selectPreviousQuery,
    selectPreviousReplaceText,
    setQuery,
    setReplaceText,
    setReplaceVisible,
    setSearchOptions,
  } = useSearchBufferInputs(rootPath)
  const { openSearchEditor } = useEditorCommands()
  const replace = useWorkspaceSearchReplace(rootPath, replaceVisible)

  return (
    <div className='border-b p-(--density-control-gap)'>
      <div className='flex items-center gap-1'>
        <SearchHistoryInput
          aria-label='Search workspace'
          className='flex-1'
          endAddon={
            <SearchModeButtons
              buttonClassName='size-5'
              className='gap-0'
              options={searchOptions}
              onOptionsChange={setSearchOptions}
            />
          }
          label='Search'
          size='sm'
          startAddon={<MagnifyingGlassIcon aria-hidden='true' className='size-3.5' />}
          type='search'
          value={query}
          onSelectNextHistory={selectNextQuery}
          onSelectPreviousHistory={selectPreviousQuery}
          onValueChange={setQuery}
        />
        <SearchReplaceToggleButton active={replaceVisible} onToggle={setReplaceVisible} />
        {showOpenInEditorButton ? (
          <Button
            aria-label='Open search editor'
            className='text-muted-foreground hover:text-foreground shrink-0'
            size='icon-sm'
            title='Open search editor'
            type='button'
            variant='ghost'
            onClick={() => openSearchEditor(filesystemPath(rootPath))}
          >
            <ArrowSquareOutIcon className='size-4' />
          </Button>
        ) : null}
      </div>
      <SearchFilterFields options={searchOptions} onOptionsChange={setSearchOptions} />
      <SearchReplaceFields
        canReplace={replace.canReplace}
        replaceText={replaceText}
        replaceVisible={replaceVisible}
        replacing={replacing}
        onReplaceAll={replace.replaceAll}
        onReplaceNext={replace.replaceNext}
        onSelectNextHistory={selectNextReplaceText}
        onSelectPreviousHistory={selectPreviousReplaceText}
        onReplaceTextChange={setReplaceText}
      />
      <SearchSummary rootPath={rootPath} />
    </div>
  )
}
