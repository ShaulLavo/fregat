import {
  ArrowDownIcon,
  ArrowUpIcon,
  EraserIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

export function TreeSearchActions({
  isOpen,
  matchCount,
  onClear,
  onClose,
  onNext,
  onOpen,
  onPrevious,
  query,
}: {
  readonly isOpen: boolean
  readonly matchCount: number
  readonly onClear: () => void
  readonly onClose: () => void
  readonly onNext: () => void
  readonly onOpen: () => void
  readonly onPrevious: () => void
  readonly query: string
}) {
  if (!isOpen) {
    return (
      <Button
        aria-label='Filter files'
        size='icon-xs'
        title='Filter Files'
        type='button'
        variant='ghost'
        onClick={onOpen}
      >
        <MagnifyingGlassIcon className='size-3.5' />
      </Button>
    )
  }

  const hasQuery = query.length > 0
  const hasMatches = hasQuery && matchCount > 0
  const matchNoun = matchCount === 1 ? 'match' : 'matches'
  const matchLabel = `${String(matchCount)} file ${matchNoun}`

  return (
    <>
      {hasQuery ? (
        <output
          aria-label={matchLabel}
          aria-live='polite'
          className='text-muted-foreground text-3xs min-w-0 truncate px-1 tabular-nums'
        >
          {matchCount} {matchNoun}
        </output>
      ) : null}
      <Button
        aria-label='Previous file match'
        disabled={!hasMatches}
        size='icon-xs'
        title='Previous Match'
        type='button'
        variant='ghost'
        onClick={onPrevious}
      >
        <ArrowUpIcon className='size-3.5' />
      </Button>
      <Button
        aria-label='Next file match'
        disabled={!hasMatches}
        size='icon-xs'
        title='Next Match'
        type='button'
        variant='ghost'
        onClick={onNext}
      >
        <ArrowDownIcon className='size-3.5' />
      </Button>
      <Button
        aria-label='Clear file filter'
        disabled={!hasQuery}
        size='icon-xs'
        title='Clear Filter'
        type='button'
        variant='ghost'
        onClick={onClear}
      >
        <EraserIcon className='size-3.5' />
      </Button>
      <Button
        aria-label='Close file filter'
        size='icon-xs'
        title='Close Filter'
        type='button'
        variant='ghost'
        onClick={onClose}
      >
        <XIcon className='size-3.5' />
      </Button>
    </>
  )
}
