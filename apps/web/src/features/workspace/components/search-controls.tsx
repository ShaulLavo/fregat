import { ArrowSquareOutIcon } from '@phosphor-icons/react'

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
    <div className='compact:p-1 border-b p-1.5'>
      <div className='flex items-center gap-1'>
        <SearchHistoryInput
          aria-label='Search workspace'
          className='flex-1'
          inputClassName='compact:h-6 compact:pl-1.5 h-7 px-2 pr-[5.5rem] text-[11px]'
          label='Search'
          rightAdornment={
            <SearchModeButtons
              buttonClassName='size-5'
              className='absolute top-1/2 right-0.5 -translate-y-1/2 gap-0'
              options={searchOptions}
              onOptionsChange={setSearchOptions}
            />
          }
          type='search'
          value={query}
          onSelectNextHistory={selectNextQuery}
          onSelectPreviousHistory={selectPreviousQuery}
          onValueChange={setQuery}
        />
        <SearchReplaceToggleButton
          active={replaceVisible}
          className='compact:h-6 compact:px-1 h-7 px-1.5'
          onToggle={setReplaceVisible}
        />
        {showOpenInEditorButton ? (
          <Button
            aria-label='Open search editor'
            className='text-muted-foreground hover:text-foreground compact:size-6 size-7 shrink-0'
            size='icon-sm'
            title='Open search editor'
            type='button'
            variant='ghost'
            onClick={() => openSearchEditor(rootPath)}
          >
            <ArrowSquareOutIcon className='size-4' />
          </Button>
        ) : null}
      </div>
      <SearchFilterFields
        className='compact:mt-1 mt-1.5 gap-1'
        inputClassName='h-6 px-1.5 text-[11px]'
        options={searchOptions}
        onOptionsChange={setSearchOptions}
      />
      <SearchReplaceFields
        buttonClassName='h-6 px-1.5 text-[10px]'
        canReplace={replace.canReplace}
        className='compact:mt-1 mt-1.5 gap-1'
        inputClassName='h-6 px-1.5 text-[11px]'
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
