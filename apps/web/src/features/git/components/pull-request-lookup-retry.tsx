import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { usePullRequestState } from '@/features/git/hooks/use-pull-request-state'
import { errorMessage } from '@/lib/error-message'

/**
 * A lookup that failed says nothing about whether a pull request exists, so it offers the lookup
 * again and never Create.
 */
export function PullRequestLookupRetry({
  requestLabel,
  rootPath,
}: {
  readonly requestLabel: string
  readonly rootPath: string
}) {
  const lookup = usePullRequestState(rootPath)
  if (!lookup.isError) return null

  return (
    <Button
      className='text-2xs'
      data-pull-request-lookup-retry=''
      disabled={lookup.isFetching}
      size='sm'
      title={errorMessage(lookup.error, `The ${requestLabel.toLowerCase()} lookup failed.`)}
      type='button'
      variant='ghost'
      onClick={() => void lookup.refetch()}
    >
      {lookup.isFetching ? <Spinner /> : <ArrowClockwiseIcon className='size-(--icon-size-sm)' />}
      Check {requestLabel.toLowerCase()} again
    </Button>
  )
}
