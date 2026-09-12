import type { ChangeEvent } from 'react'
import { useId } from 'react'

import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { Input } from '@workspace/ui/components/input'

type SearchFilterFieldsProps = {
  options: WorkspaceSearchQueryOptions
  onOptionsChange: (options: SearchBufferOptionPatch) => void
}

export function SearchFilterFields({ options, onOptionsChange }: SearchFilterFieldsProps) {
  const includeId = useId()
  const excludeId = useId()

  function handleIncludeChange(event: ChangeEvent<HTMLInputElement>) {
    onOptionsChange({ includeGlobText: event.target.value })
  }

  function handleExcludeChange(event: ChangeEvent<HTMLInputElement>) {
    onOptionsChange({ excludeGlobText: event.target.value })
  }

  if (!options.filtersVisible) return null

  return (
    <div className='mt-(--density-control-gap) grid grid-cols-2 gap-(--density-control-gap)'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <label className='text-muted-foreground text-2xs font-medium' htmlFor={includeId}>
          Include
        </label>
        <Input
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          className='text-2xs h-(--density-control-height-sm)'
          id={includeId}
          placeholder='src/**/*.ts'
          spellCheck={false}
          value={options.includeGlobText}
          onChange={handleIncludeChange}
        />
      </div>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <label className='text-muted-foreground text-2xs font-medium' htmlFor={excludeId}>
          Exclude
        </label>
        <Input
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          className='text-2xs h-(--density-control-height-sm)'
          id={excludeId}
          placeholder='**/dist/**'
          spellCheck={false}
          value={options.excludeGlobText}
          onChange={handleExcludeChange}
        />
      </div>
    </div>
  )
}
