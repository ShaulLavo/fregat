import type { ChangeEvent } from 'react'

import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

type SearchFilterFieldsProps = {
  className?: string
  inputClassName?: string
  options: WorkspaceSearchQueryOptions
  onOptionsChange: (options: SearchBufferOptionPatch) => void
}

export function SearchFilterFields({
  className,
  inputClassName,
  options,
  onOptionsChange,
}: SearchFilterFieldsProps) {
  if (!options.filtersVisible) return null

  function handleIncludeChange(event: ChangeEvent<HTMLInputElement>) {
    onOptionsChange({ includeGlobText: event.target.value })
  }

  function handleExcludeChange(event: ChangeEvent<HTMLInputElement>) {
    onOptionsChange({ excludeGlobText: event.target.value })
  }

  return (
    <div className={cn('mt-2 grid grid-cols-2 gap-1.5', className)}>
      <Input
        aria-label='Files to include'
        autoCapitalize='off'
        autoCorrect='off'
        className={cn('h-(--density-control-height-sm) text-2xs', inputClassName)}
        placeholder='include'
        spellCheck={false}
        value={options.includeGlobText}
        onChange={handleIncludeChange}
      />
      <Input
        aria-label='Files to exclude'
        autoCapitalize='off'
        autoCorrect='off'
        className={cn('h-(--density-control-height-sm) text-2xs', inputClassName)}
        placeholder='exclude'
        spellCheck={false}
        value={options.excludeGlobText}
        onChange={handleExcludeChange}
      />
    </div>
  )
}
