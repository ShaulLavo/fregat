import { SearchHistoryInput } from '@/features/search/components/history-input'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

type SearchReplaceFieldsProps = {
  buttonClassName?: string
  canReplace: boolean
  className?: string
  inputClassName?: string
  replaceText: string
  replaceVisible: boolean
  replacing: boolean
  onReplaceAll: () => void
  onReplaceNext: () => void
  onSelectNextHistory: () => void
  onSelectPreviousHistory: () => void
  onReplaceTextChange: (replaceText: string) => void
}

export function SearchReplaceFields({
  buttonClassName,
  canReplace,
  className,
  inputClassName,
  replaceText,
  replaceVisible,
  replacing,
  onReplaceAll,
  onReplaceNext,
  onSelectNextHistory,
  onSelectPreviousHistory,
  onReplaceTextChange,
}: SearchReplaceFieldsProps) {
  if (!replaceVisible) return null

  return (
    <div className={cn('mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5', className)}>
      <SearchHistoryInput
        aria-label='Replace in workspace'
        inputClassName={cn('h-(--density-control-height-sm) text-2xs', inputClassName)}
        label='Replace'
        value={replaceText}
        onSelectNextHistory={onSelectNextHistory}
        onSelectPreviousHistory={onSelectPreviousHistory}
        onValueChange={onReplaceTextChange}
      />
      <Button
        className={cn('text-2xs', buttonClassName)}
        disabled={!canReplace || replacing}
        size='sm'
        type='button'
        variant='outline'
        onClick={onReplaceNext}
      >
        Next
      </Button>
      <Button
        className={cn('text-2xs', buttonClassName)}
        disabled={!canReplace || replacing}
        size='sm'
        type='button'
        variant='outline'
        onClick={onReplaceAll}
      >
        All
      </Button>
    </div>
  )
}
