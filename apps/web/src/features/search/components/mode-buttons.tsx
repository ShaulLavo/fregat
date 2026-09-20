import { AsteriskIcon, FunnelSimpleIcon, TextAaIcon, TextTIcon } from '@phosphor-icons/react'

import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import { SearchToggleButton } from '@/features/search/components/toggle-button'
import type { WorkspaceSearchQueryOptions } from '@/features/search/utils/buffer-query'
import { cn } from '@workspace/ui/lib/utils'

type SearchModeButtonsProps = {
  buttonClassName?: string
  className?: string
  options: WorkspaceSearchQueryOptions
  onOptionsChange: (options: SearchBufferOptionPatch) => void
}

export function SearchModeButtons({
  buttonClassName,
  className,
  options,
  onOptionsChange,
}: SearchModeButtonsProps) {
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <SearchToggleButton
        active={options.caseSensitive}
        className={buttonClassName}
        label='Match case'
        onClick={() => onOptionsChange({ caseSensitive: !options.caseSensitive })}
      >
        <TextAaIcon className='size-(--icon-size-sm)' />
      </SearchToggleButton>
      <SearchToggleButton
        active={options.wholeWord}
        className={buttonClassName}
        label='Match whole word'
        onClick={() => onOptionsChange({ wholeWord: !options.wholeWord })}
      >
        <TextTIcon className='size-(--icon-size-sm)' />
      </SearchToggleButton>
      <SearchToggleButton
        active={options.matchMode === 'regex'}
        className={buttonClassName}
        label='Use regular expression'
        onClick={() =>
          onOptionsChange({
            matchMode: options.matchMode === 'regex' ? 'literal' : 'regex',
          })
        }
      >
        <AsteriskIcon className='size-(--icon-size-sm)' />
      </SearchToggleButton>
      <SearchToggleButton
        active={options.filtersVisible}
        className={buttonClassName}
        label='Include and exclude files'
        onClick={() => onOptionsChange({ filtersVisible: !options.filtersVisible })}
      >
        <FunnelSimpleIcon className='size-(--icon-size-sm)' />
      </SearchToggleButton>
    </div>
  )
}
