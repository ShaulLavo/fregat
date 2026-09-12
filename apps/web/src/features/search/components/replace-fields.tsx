import { SearchHistoryInput } from '@/features/search/components/history-input'
import { Button } from '@workspace/ui/components/button'

type SearchReplaceFieldsProps = {
  canReplace: boolean
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
  canReplace,
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
    <div className='mt-(--density-control-gap) grid grid-cols-[minmax(0,1fr)_auto_auto] gap-(--density-control-gap)'>
      <SearchHistoryInput
        aria-label='Replace in workspace'
        label='Replace'
        size='sm'
        value={replaceText}
        onSelectNextHistory={onSelectNextHistory}
        onSelectPreviousHistory={onSelectPreviousHistory}
        onValueChange={onReplaceTextChange}
      />
      <Button
        className='text-2xs'
        disabled={!canReplace || replacing}
        size='sm'
        type='button'
        variant='outline'
        onClick={onReplaceNext}
      >
        Next
      </Button>
      <Button
        className='text-2xs'
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
