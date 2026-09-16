import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import { SearchFilterFields } from '@/features/search/components/filter-fields'
import { SearchHistoryInput } from '@/features/search/components/history-input'
import { SearchModeButtons } from '@/features/search/components/mode-buttons'
import { SearchReplaceFields } from '@/features/search/components/replace-fields'
import { SearchReplaceToggleButton } from '@/features/search/components/replace-toggle-button'
import { SearchSummary } from '@/features/search/components/summary'
import { useSearchBufferInputs } from '@/features/search/hooks/use-buffer-inputs'
import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import { useOwnedText } from '@/hooks/use-owned-text'

export function SearchControls({
  compact = true,
  rootPath,
}: {
  compact?: boolean
  rootPath: string
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
  const replace = useWorkspaceSearchReplace(rootPath, replaceVisible)
  const [queryText, changeQuery] = useOwnedText(query, setQuery)

  const queryField = (
    <SearchHistoryInput
      aria-label='Search workspace'
      className='min-w-0 flex-1'
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
      value={queryText}
      onSelectNextHistory={selectNextQuery}
      onSelectPreviousHistory={selectPreviousQuery}
      onValueChange={changeQuery}
    />
  )
  const replaceToggle = (
    <SearchReplaceToggleButton active={replaceVisible} onToggle={setReplaceVisible} />
  )
  const filterFields = (
    <SearchFilterFields options={searchOptions} onOptionsChange={setSearchOptions} />
  )
  const replaceFields = (
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
  )

  if (compact) {
    return (
      <div className='border-b'>
        <PaneBar>
          {queryField}
          {replaceToggle}
        </PaneBar>
        <div className='px-(--bar-padding-x) pb-(--density-control-gap) empty:hidden'>
          {filterFields}
          {replaceFields}
        </div>
      </div>
    )
  }

  return (
    <div className='border-b p-(--density-control-gap)'>
      <div className='flex items-center gap-1'>
        {queryField}
        {replaceToggle}
      </div>
      {filterFields}
      {replaceFields}
      <SearchSummary className='text-3xs mt-1 gap-1 px-0' rootPath={rootPath} />
    </div>
  )
}
