import { ArrowUpIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

/**
 * Reaches the history the detail window left behind. An overlay rather than a
 * virtualized row: a row at index 0 would grow and shrink inside the same
 * measurement pass the prepend is being absorbed in, and fight it.
 */
export function TimelineLoadEarlier({
  error,
  pending,
  onLoad,
}: {
  readonly error: string | null
  readonly onLoad: () => void
  readonly pending: boolean
}) {
  return (
    <div className='pointer-events-none absolute inset-x-0 top-2 flex justify-center'>
      <Button
        className='backdrop-material pointer-events-auto shadow-md'
        disabled={pending}
        size='sm'
        type='button'
        variant='outline'
        onClick={onLoad}
      >
        {pending ? (
          <Spinner size='xs' />
        ) : (
          <ArrowUpIcon aria-hidden='true' className='size-(--icon-size-sm)' />
        )}
        {loadEarlierLabel(error, pending)}
      </Button>
    </div>
  )
}

function loadEarlierLabel(error: string | null, pending: boolean) {
  if (pending) return 'Loading earlier'
  if (error) return 'Retry loading earlier'

  return 'Load earlier'
}
