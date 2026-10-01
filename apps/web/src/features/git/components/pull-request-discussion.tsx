import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { ModuleLoadError } from '@/components/module-load-error'
import { discussionDialogQueryOptions } from '@/features/git/utils/discussion-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function PullRequestDiscussion({
  rootPath,
  number,
  url,
}: {
  readonly rootPath: string
  readonly number: number
  readonly url: string
}) {
  const subject = JSON.stringify([rootPath, number])
  const [openSubject, setOpenSubject] = useState<string | null>(null)
  const open = openSubject === subject
  const onOpenChange = (value: boolean) => setOpenSubject(value ? subject : null)
  const query = useQuery({ ...discussionDialogQueryOptions, enabled: open }, resourceQueryClient)

  function prefetch() {
    // The query owns a failed import; the open dialog offers its retry.
    void resourceQueryClient.query(discussionDialogQueryOptions).catch(() => {})
  }

  const View = query.data?.DiscussionDialog
  return (
    <>
      <Button
        size='sm'
        variant='ghost'
        className='text-2xs'
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={() => onOpenChange(true)}
      >
        Discussion
      </Button>
      {View ? (
        <RenderErrorBoundary label='pull request discussion' resetKeys={[subject]}>
          <View
            rootPath={rootPath}
            number={number}
            url={url}
            open={open}
            onOpenChange={onOpenChange}
          />
        </RenderErrorBoundary>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent finalFocus={returnFocusUnlessLoaded}>
            <DialogHeader>
              <DialogTitle>Pull request #{number} discussion</DialogTitle>
              <DialogDescription>Read and post comments on the Git host.</DialogDescription>
            </DialogHeader>
            {query.isPending ? (
              <Spinner size='md' label='Loading discussion' />
            ) : (
              <ModuleLoadError
                label='pull request discussion'
                onRetry={() => void query.refetch()}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// The loaded dialog holds focus when the loading shell unmounts.
function returnFocusUnlessLoaded() {
  return (
    resourceQueryClient.getQueryState(discussionDialogQueryOptions.queryKey)?.status !== 'success'
  )
}
